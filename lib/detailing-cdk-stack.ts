import {
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { AutoScalingGroup, Signals } from "aws-cdk-lib/aws-autoscaling";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import {
  BuildSpec,
  LinuxBuildImage,
  PipelineProject,
} from "aws-cdk-lib/aws-codebuild";
import { ServerDeploymentGroup } from "aws-cdk-lib/aws-codedeploy";
import { Artifact, Pipeline } from "aws-cdk-lib/aws-codepipeline";
import {
  CodeBuildAction,
  CodeDeployServerDeployAction,
  GitHubSourceAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import {
  AmazonLinuxGeneration,
  AmazonLinuxImage,
  CloudFormationInit,
  InitCommand,
  InitFile,
  InitPackage,
  InitService,
  InitServiceRestartHandle,
  InstanceType,
  IpAddresses,
  KeyPair,
  LaunchTemplate,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  CompositePrincipal,
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class DetailingCdkStack extends Stack {
  private domain: string;
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.domain = scope.node.getContext("domain");

    const hostedZone = new HostedZone(this, "BarrhavenDetailingHostedZone", {
      zoneName: this.domain,
    });

    const certificate = new Certificate(this, "BarrhavenDetailingCertificate", {
      domainName: this.domain,
      subjectAlternativeNames: [`*.${this.domain}`],
      validation: CertificateValidation.fromDns(hostedZone),
    });

    // EMAIL
    // const ses = new CfnEmailIdentity(this, "BarrhavenDetailingEmailIdentity", {
    //   emailIdentity: "khanriza@gmail.com",
    // });
    //
    // const sesUser = new User(this, "BarrhavenDetailingSESUser", {
    //   userName: "barrhaven-detailing",
    // });

    // VPC
    const vpc = new Vpc(this, "VPC", {
      vpcName: "BarrhavenDetailingVPC",
      ipAddresses: IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: SubnetType.PUBLIC,
        },
      ],
    });

    // Security Group
    const securityGroup = new SecurityGroup(this, "BarrhavenDetailingSecurityGroup", {
      securityGroupName: "BarrhavenDetailingSecurityGroup",
      vpc,
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      "allow https access",
    );
    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(80),
      "allow http access",
    );
    securityGroup.addIngressRule(
      Peer.ipv4("0.0.0.0/0"),
      Port.tcp(22),
      "allow ssh access",
    );

    // InstanceTemplate
    const autoScalingGroup = new AutoScalingGroup(this, "BarrhavenDetailingAutoScalingGroup", {
      vpc,
      launchTemplate: new LaunchTemplate(this, "BarrhavenDetailingLaunchTemplate", {
        instanceType: new InstanceType("t3.micro"),
        machineImage: new AmazonLinuxImage({
          generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
        }),
        securityGroup,
        role: new Role(this, "Role", {
          assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
          managedPolicies: [
            ManagedPolicy.fromAwsManagedPolicyName(
              "AmazonSSMManagedInstanceCore",
            ),
          ],
          // inlinePolicies: {
          //   ses: new PolicyDocument({
          //     statements: [
          //       new PolicyStatement({
          //         actions: ["ses:SendEmail", "ses:SendRawEmail"],
          //         resources: ["*"],
          //       }),
          //     ],
          //   }),
          // },
        }),
        keyPair: new KeyPair(this, "DetailingKeyPair", {
          keyPairName: "DetailingKeyPair",
        }),
      }),
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      init: CloudFormationInit.fromElements(
        InitPackage.yum("nginx"),
        InitCommand.shellCommand(
          "sudo yum install php php-fpm php-xml php-mbstring php-zip php-bcmath php-tokenizer ruby wget sqlite -y",
        ),
        InitFile.fromAsset(
          "/etc/nginx/conf.d/laravel.conf", // Destination
          "cfninit/laravel.conf", // Where the file is located
        ),
        InitService.enable("nginx", {
          serviceRestartHandle: new InitServiceRestartHandle(),
        }),
      ),
      signals: Signals.waitForCount(1, {
        minSuccessPercentage: 80,
        timeout: Duration.minutes(5),
      }),
    });

    // Load balancer
    const applicationLoadBalancer = new ApplicationLoadBalancer(
      this,
      "BarrhaveDetailingALB",
      {
        vpc,
        internetFacing: true,
        securityGroup,
      },
    );

    const targetGroup = new ApplicationTargetGroup(
      this,
      "BarrhavenDetailingTargetGroup",
      {
        vpc,
        targetType: TargetType.INSTANCE,
        port: 80,
        targets: [autoScalingGroup],
        healthCheck: {
          path: "/",
          interval: Duration.minutes(1),
        },
      },
    );

    // WARN: Is this needed?
    // applicationLoadBalancer.addListener("BarrhavenDetailingListener", {
    //   port: 80,
    //   open: true,
    //   defaultTargetGroups: [targetGroup],
    // });

    const httpsListener = applicationLoadBalancer.addListener("HTTPSListener", {
      port: 443,
      certificates: [certificate], // Your SSL certificate from ACM
      open: true,
    });

    httpsListener.addTargetGroups("BarrhavenDetailingTargetGroup", {
      targetGroups: [targetGroup],
    });

    new ARecord(this, "ARecord", {
      zone: hostedZone,
      target: RecordTarget.fromAlias(
        new LoadBalancerTarget(applicationLoadBalancer),
      ),
      recordName: `www.${this.domain}`,
    });

    new ARecord(this, "RootARecord", {
      zone: hostedZone,
      target: RecordTarget.fromAlias(
        new LoadBalancerTarget(applicationLoadBalancer),
      ),
      recordName: this.domain, // root domain
    });

    const sourceArtifact = new Artifact("DetailingSourceArtifact");
    const buildArtifact = new Artifact("DetailingBuildArtifact");

    new Pipeline(this, "Pipeline", {
      pipelineName: "DetailingPipeline",
      role: new Role(this, "PipelineRole", {
        assumedBy: new CompositePrincipal(
          new ServicePrincipal("codebuild.amazonaws.com"),
          new ServicePrincipal("codepipeline.amazonaws.com"),
        ),
        inlinePolicies: {
          CdkDeployPermissions: new PolicyDocument({
            statements: [
              new PolicyStatement({
                actions: ["sts:AssumeRole"],
                resources: ["arn:aws:iam::*:role/cdk-*"],
              }),
            ],
          }),
        },
      }),
      artifactBucket: new Bucket(this, "DetailingArtifactBucket", {
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      stages: [
        {
          stageName: "Source",
          actions: [
            new GitHubSourceAction({
              actionName: "Source",
              owner: "RizaHKhan",
              repo: "detailing",
              branch: "master",
              oauthToken: SecretValue.secretsManager("barrhaven-detailing"),
              output: sourceArtifact,
            }),
          ],
        },
        {
          stageName: "Build",
          actions: [
            new CodeBuildAction({
              actionName: "Build",
              project: new PipelineProject(this, "BuildProject", {
                environment: {
                  buildImage: LinuxBuildImage.AMAZON_LINUX_2_5,
                },
                buildSpec: BuildSpec.fromObject({
                  version: "0.2",
                  phases: {
                    install: {
                      "runtime-versions": {
                        nodejs: "20.x",
                        php: "8.3",
                      },
                      commands: [
                        "npm install",
                        "curl -sS https://getcomposer.org/installer | php", // Install Composer
                        "php composer.phar install --no-dev --optimize-autoloader", // Install PHP dependencies
                      ],
                    },
                    build: {
                      commands: ["npm run build"],
                    },
                  },
                  artifacts: {
                    "base-directory": "./", // Adjust this to the appropriate base directory if different
                    files: [
                      "**/*", // Frontend assets
                    ],
                  },
                }),
              }),
              input: sourceArtifact,
              outputs: [buildArtifact],
            }),
          ],
        },
        {
          stageName: "Deploy",
          actions: [
            new CodeDeployServerDeployAction({
              actionName: "DeployToEc2",
              input: buildArtifact,
              deploymentGroup: new ServerDeploymentGroup(
                this,
                "DeploymentGroup",
                {
                  autoScalingGroups: [autoScalingGroup],
                },
              ),
            }),
          ],
        },
      ],
    });
  }
}
