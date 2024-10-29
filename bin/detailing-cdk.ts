#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DetailingCdkStack } from "../lib/detailing-cdk-stack";

const app = new cdk.App();
new DetailingCdkStack(app, "DetailingCdkStack", {
});
