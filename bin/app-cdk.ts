#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { env } from "process";
import { AppCdkStack } from "../lib/app-cdk-stack";

const { CDK_DEFAULT_ACCOUNT } = env;

const app = new App({
  context: {
    domain: "test.com",
    env: { region: "us-east-1", account: CDK_DEFAULT_ACCOUNT },
  },
});

new AppCdkStack(app, "AppCdkStack", {});
