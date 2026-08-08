import { WorkerEntrypoint } from "cloudflare:workers";
import {
  createWebsiteManagementDependencies,
  executeWebsiteManagementRead,
} from "./website-management-api";

/** Internal service-binding RPC entrypoint. It intentionally has no public fetch handler. */
export class WebsiteManagementApi extends WorkerEntrypoint<Env> {
  describeManagementContract(input: unknown) {
    return executeWebsiteManagementRead(
      "describeManagementContract",
      input,
      createWebsiteManagementDependencies(this.env),
    );
  }

  getEffectiveConfiguration(input: unknown) {
    return executeWebsiteManagementRead(
      "getEffectiveConfiguration",
      input,
      createWebsiteManagementDependencies(this.env),
    );
  }

  getDiagnostics(input: unknown) {
    return executeWebsiteManagementRead(
      "getDiagnostics",
      input,
      createWebsiteManagementDependencies(this.env),
    );
  }
}
