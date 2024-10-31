import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

export default function distributionConstruct(scope: Construct, name: string) {
  const domain = scope.node.getContext("domain");

  const hostedZone = new HostedZone(scope, `${name}HostedZone`, {
    zoneName: domain,
  });

  const certificate = new Certificate(scope, `${name}Certificate`, {
    domainName: domain,
    subjectAlternativeNames: [`*.${domain}`],
    validation: CertificateValidation.fromDns(hostedZone),
  });

  const setARecords = (applicationLoadBalancer: ApplicationLoadBalancer) => {
    new ARecord(scope, `${name}ARecord`, {
      zone: hostedZone,
      target: RecordTarget.fromAlias(
        new LoadBalancerTarget(applicationLoadBalancer),
      ),
      recordName: `www.${domain}`,
    });

    new ARecord(scope, `${name}RootARecord`, {
      zone: hostedZone,
      target: RecordTarget.fromAlias(
        new LoadBalancerTarget(applicationLoadBalancer),
      ),
      recordName: domain, // root domain
    });
  };

  return { domain, hostedZone, certificate, setARecords };
}
