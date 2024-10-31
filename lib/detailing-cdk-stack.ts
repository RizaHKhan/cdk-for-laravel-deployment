import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import codepipelineConstruct from "./constructs/pipeline";
import distributionConstruct from "./constructs/distribution";
import networkingConstruct from "./constructs/networking";
import computeStack from "./constructs/compute";
import storageConstruct from "./constructs/storage";

export class DetailingCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const name = "BarrhavenDetailing";

    const { vpc, securityGroup } = networkingConstruct(this, name);
    const { certificate, setARecords } = distributionConstruct(this, name);

    const { applicationLoadBalancer, autoScalingGroup } = computeStack(
      this,
      name,
      {
        vpc,
        securityGroup,
        certificate,
      },
    );

    setARecords(applicationLoadBalancer);
    const { artifactBucket } = storageConstruct(this, name);

    codepipelineConstruct(this, "Production", {
      branch: "master",
      autoScalingGroup,
      artifactBucket,
    });

    codepipelineConstruct(this, "Dev", {
      branch: "dev",
      autoScalingGroup,
      artifactBucket,
    });
  }
}
