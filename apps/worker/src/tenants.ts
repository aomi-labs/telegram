import { assertNoReservedCommands, commandNames, type Tenant } from "@aomi-telegram/core";
import { world } from "@aomi-telegram/tenant-world";

/** Every tenant module the worker knows how to serve. Registered by code, keyed by id. */
const modules: Tenant<any>[] = [world];

export const tenants: ReadonlyMap<string, Tenant<any>> = new Map(
  modules.map((tenant) => {
    assertNoReservedCommands(commandNames(tenant));
    return [tenant.id, tenant] as const;
  }),
);
