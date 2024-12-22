import { Duration } from "aws-cdk-lib";
import { AutoScalingGroup, Signals } from "aws-cdk-lib/aws-autoscaling";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
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
  KeyPair,
  LaunchTemplate,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface Props {
  vpc: Vpc;
  securityGroup: SecurityGroup;
  certificate: Certificate;
}

export default function computeStack(
  scope: Construct,
  name: string,
  { vpc, securityGroup, certificate }: Props,
) {
  const autoScalingGroup = new AutoScalingGroup(
    scope,
    `${name}AutoScalingGroup`,
    {
      vpc,
      launchTemplate: new LaunchTemplate(scope, `${name}LaunchTemplate`, {
        instanceType: new InstanceType("t2.micro"),
        machineImage: new AmazonLinuxImage({
          generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
        }),
        securityGroup,
        role: new Role(scope, "Role", {
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
        keyPair: new KeyPair(scope, `${name}KeyPair`, {
          keyPairName: `${name}KeyPair`,
        }),
      }),
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      init: CloudFormationInit.fromElements(
        InitPackage.yum("nginx"),
        InitCommand.shellCommand(
          "sudo yum install php php-fpm php-xml php-mbstring php-zip php-bcmath php-tokenizer ruby wget sqlite httpd-tools -y",
        ),
        InitFile.fromAsset("/etc/nginx/.htpasswd", "cfninit/.htpasswd"),
        InitFile.fromAsset(
          "/etc/nginx/conf.d/site.conf", // Destination
          "cfninit/site.conf", // Where the file is located
        ),
        InitService.enable("nginx", {
          serviceRestartHandle: new InitServiceRestartHandle(),
        }),
      ),
      signals: Signals.waitForCount(1, {
        minSuccessPercentage: 80,
        timeout: Duration.minutes(30),
      }),
    },
  );

  // Load balancer
  const applicationLoadBalancer = new ApplicationLoadBalancer(
    scope,
    `${name}ALB`,
    {
      vpc,
      internetFacing: true,
      securityGroup,
    },
  );

  const targetGroup = new ApplicationTargetGroup(scope, `${name}TargetGroup`, {
    vpc,
    targetType: TargetType.INSTANCE,
    port: 80,
    targets: [autoScalingGroup],
    healthCheck: {
      path: "/",
      interval: Duration.minutes(1),
    },
  });

  const httpsListener = applicationLoadBalancer.addListener(
    `${name}HTTPSListener`,
    {
      port: 443,
      certificates: [certificate], // Your SSL certificate from ACM
      open: true,
    },
  );

  httpsListener.addTargetGroups(`${name}TargetGroup`, {
    targetGroups: [targetGroup],
  });

  return { autoScalingGroup, applicationLoadBalancer };
}
