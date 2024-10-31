import {
  IpAddresses,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export default function networkingConstruct(scope: Construct, name: string) {
  const vpc = new Vpc(scope, "VPC", {
    vpcName: `${name}VPC`,
    ipAddresses: IpAddresses.cidr("10.0.0.0/16"),
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      {
        cidrMask: 24,
        name: "Public",
        subnetType: SubnetType.PUBLIC,
      },
    ],
  });

  const securityGroup = new SecurityGroup(scope, `${name}SecurityGroup`, {
    securityGroupName: `${name}SecurityGroup`,
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

  return { vpc, securityGroup };
}
