import { RemovalPolicy } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export default function storageConstruct(scope: Construct, name: string) {
  const artifactBucket = new Bucket(scope, `${name}Bucket`, {
    removalPolicy: RemovalPolicy.DESTROY,
  });

  return { artifactBucket };
}
