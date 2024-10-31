import { SecretValue } from "aws-cdk-lib";
import { Artifact, Pipeline } from "aws-cdk-lib/aws-codepipeline";
import { Construct } from "constructs";
import {
  CompositePrincipal,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  CodeBuildAction,
  CodeDeployServerDeployAction,
  GitHubSourceAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import { BuildSpec, LinuxBuildImage, PipelineProject } from "aws-cdk-lib/aws-codebuild";
import { ServerDeploymentGroup } from "aws-cdk-lib/aws-codedeploy";
import { AutoScalingGroup } from "aws-cdk-lib/aws-autoscaling";

interface Props {
  autoScalingGroup: AutoScalingGroup;
  artifactBucket: Bucket
  branch: string
}

export default function codepipelineConstruct(
  scope: Construct,
  name: string,
  { branch, autoScalingGroup, artifactBucket }: Props,
) {

  const sourceArtifact = new Artifact(`${name}DetailingSourceArtifact`);
  const buildArtifact = new Artifact(`${name}DetailingBuildArtifact`);

  new Pipeline(scope, name, {
    pipelineName: `${name}DetailingPipeline`,
    role: new Role(scope, `${name}PipelineRole`, {
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
    artifactBucket,
    stages: [
      {
        stageName: "Source",
        actions: [
          new GitHubSourceAction({
            actionName: "Source",
            owner: "RizaHKhan",
            repo: "detailing",
            branch,
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
            project: new PipelineProject(scope, `${name}BuildProject`, {
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
              scope,
              `${name}DeploymentGroup`,
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
