# CDK for Laravel deployment

Distributing a Laravel application to AWS can be complicated. It requires knowledge of multiple technologies and how they work together.

I hope this guide will help you setup your own app on the AWS cloud.

## AWS CDK

This will be built using AWS's CDK. This is a AWS specific tool that allows developers to create infrastructure as code using a declaratice programming language. We choose to use Typescript as our language of choice.

After having written Cloudformation Templates, building AWS within the CDK is a breath of fresh air.

## Overview

We will keep things fairly simple for this example. We will be deploying this application to a EC2 instance which is created from an Autoscaling group template.

The database will also live within the EC2 instance (Sqlite). The main reason for this is cost. RDS is much more expensive, justifiably so, as it does quite a bit of heavy lifting for the user, but if our app will start out small, we don't really need the extra functionality RDS provides.

Finally, we will hook up all of the loose ends with a Codepipeline which will take our applications code from Github and place it in the EC2 instance.

### [Networking](lib/constructs/networking.ts)

#### VPC

```typescript
const vpc = new Vpc(scope, "VPC", {
  vpcName: "VPCName",
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
```

Here we are creating an EC2 that contains one public subnet. We are also allowing this VPC to span two availability zones. Later you will see that the Autoscaling group will use this number to determine how many instances it needs to create.

#### Security Group

```typescript
const securityGroup = new SecurityGroup(scope, "SecurityGroupName", {
  securityGroupName: "SecurityGroupName",
  vpc,
  allowAllOutbound: true,
});

securityGroup.addIngressRule(
  Peer.anyIpv4(),
  Port.tcp(443),
  "Allow HTTPS Access",
);

securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80), "Allow HTTP access");

securityGroup.addIngressRule(
  Peer.ipv4("0.0.0.0/0"),
  Port.tcp(22),
  "Allow SSH Access",
);
```

Here we have created a security group that allows for outbound requests. We hvae also opened up some ports for communication. 443 for HTTPS communication, 80 for HTTP communication. And on occasion port 22 for SSH access.

I don't suggest we SSH into the EC2 instance and start making critical modifications (that is what the CDK is for), but it is good to go in and poke around and see if configurations are accurate. It will also help for debugging. For example, why isn't this particular package being installed? When trying it directly in the EC2 instance, it displays the appropriate error which can be used to configure the CDK code.

### Distribution

Create a Hosted Zone that takes in the purchased domain.

```typescript
const hostedZone = new HostedZone(scope, "HostedZoneName", {
  zoneName: "mydomain.com",
});
```

Create a certificate for the domain

```typescript
const certificate = new Certificate(scope, "CertificateName", {
  domainName: "mydomain.com",
  subjectAlternativeNames: ["*.mydomain.com"],
  validation: CertificateValidation.fromDns(hostedZone),
});
```

We will also need to create an ARecord for the domains we need. For the base `mydomain.com`, `www.mydomain.com` and `dev.mydomain.com` as examples. Note, this will require an Application Load Balancer for the target value.

```typescript
new ARecord(scope, "RootARecord", {
  zone: hostedZone,
  target: RecordTarget.fromAlias(
    new LoadBalancerTarget(applicationLoadBalancer),
  ),
  recordName: `mydomain.com`, // This will be different
});
```

### Compute

Our application will live within an EC2 instance. However, we want this infrastructure to be elastic and flexible.

Here are the properties we need to fill out for our autoscaling group, and we'll go in to details as we go along.

| Property         | Description                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `vpc`            | We've already created thie above                                                                                     |
| `launchTemplate` | Specify what type of instance will be created. The type, the OS (Linux most likely) distribution                     |
| `vpcSubnets`     | What vpc subnet will this template be placed in?                                                                     |
| `init`           | We will use `CloudformationInit` here to setup the EC2 with the appropriate packges and services for Laravel to work |
| `signals`        | When using `CloudformationInit` we need to add this property                                                         |

We have a specific launch template

```typescript
{
  launchTemplate: new LaunchTemplate(scope, "LaunchTemplateName", {
    instanceType: new InstanceType("t2.micro"),
    machineImage: new AmazonLinuxImage({
      generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
    }),
    securityGroup,
    role: new Role(scope, "Role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    }),
    keyPair: new KeyPair(scope, "KeyPairName", {
      keyPairName: "KeyPair",
    }),
  });
}
```

#### Cfninit

```typescript
init: CloudFormationInit.fromElements(
  InitPackage.yum("nginx"),
  InitCommand.shellCommand(
    "sudo yum install php php-fpm php-xml php-mbstring php-zip php-bcmath php-tokenizer ruby wget sqlite httpd-tools -y",
  ),
  InitFile.fromAsset("/etc/nginx/.htpasswd", "cfninit/.htpasswd"),
  InitFile.fromAsset(
    "/etc/nginx/conf.d/site.conf", // Destination on the EC2 instance
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
```

In the CloudformationInit block, we are creating the specific environment needed to run our Laravel application. This involves the Nginx web server along with a number of PHP libraries.

You will need to be careful here, there are some packages that are common and available via the `InitPackage.yum('nginx')` method, but others will need to be added via `InitCommand.shellCommand('...packages go here')`. You will need to experiment to make sure you build the environment appropriately.

We can also create configuration files and copy them directly to the appropriate location when we deploy.

If the build fails due to a signal error, it means something in that chain failed (ie, a package didn't install) so checking that process would be a first good step.

Compute would also include services like load balancers (to send requests to the appropriate EC2 instance), target group and HTTPS listeners.

### CI/CD Automation

The glue for this infrastructure will be the Codepipeline that will take the application code from Github(or similar) and builds it to the EC2 via a pipeline.

The PHP side is simple, where we just want to run `composer install` for the packages. For the Javascript portion, we need to minify the files so they are small as possible because they will be sent to the client for processing.

Lets strip down the Pipeline L2 Construct to see what we need to build the pipeline

```typescript
new Pipeline(scope, name, {
  pipelineName: "PipelineName",
  role: new Role(scope, "PipelineRoleName", {}),
  artifactBucket,
  stages: [
    {
      stageName: "Source",
      actions: [],
    },
    {
      stageName: "Build",
      actions: [],
    },
    {
      stageName: "Deploy",
      actions: [],
    },
  ],
});
```

So a Role that gives permission to perform the necessary actions. A S3 bucket that will store the initial version. And finally stages, which is are sequential actions to perform on the code.

First we will source the code (pull it from the repository).
Second we will build the code (ie, `composer install`, `npm install`).
Finally, we will deploy the code to the autoscaling group we created earlier.

This is not an exhaustive list of stages though. We could add more stages (ie, Testing) as needed.

There is also a hidden piece here.

The repository also needs a `appspec.yml` file that will hold additional configuration:

```yml
version: 0.0
os: linux

files:
  - source: /
    destination: /var/www/mydomain.ca
    file_exists_behavior: OVERWRITE
hooks:
  AfterInstall:
    - location: scripts/after-install.sh
      timeout: 300
      runas: root
```

Here we take the source (content inside `buildArtifact` from the Deploy stage), and copy it to `/var/wwww/mydomain.ca`.

The `after-install.sh` could contain the following:
```bash
#!/bin/bash

if [[ ! -f /var/www/mydomain.ca/.env ]]; then
    cp /var/www/mydomain.com/.env.example /var/www/mydomain.com/.env

    cd /var/www/mydomain.com
    php artisan key:generate
fi

cd /var/www/mydomain.com
php artisan config:cache
php artisan route:cache
php artisan view:cache

cd /var/www
sudo chmod -R 777 /var/www
sudo chown -R nginx:nginx /var/www

sudo systemctl restart nginx
sudo systemctl enable nginx
```

Once the code has been copied, we will need to perform some actions (ie, clear cache, restart nginx).

## Things I didn't do

1. Create a real Database
2. Creating triggers for when the autoscaling group would expand

## Ideas for other articles

1. Create a manageed database within EC2 using the CDK (RDS alternative).
   - Should perform regular backups etc.
