import type { Connector, ConnectorDescriptor } from "./types.js";

/** In-memory registry of available connectors, keyed by connector id. */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    if (this.connectors.has(connector.id)) {
      throw new Error(`Connector "${connector.id}" is already registered.`);
    }
    this.connectors.set(connector.id, connector);
  }

  get(id: string): Connector | undefined {
    return this.connectors.get(id);
  }

  require(id: string): Connector {
    const connector = this.connectors.get(id);
    if (!connector) {
      const known = this.list().map((c) => c.id).join(", ") || "none";
      throw new Error(`Unknown connector "${id}". Available: ${known}.`);
    }
    return connector;
  }

  list(): readonly ConnectorDescriptor[] {
    return [...this.connectors.values()].map((c) => ({
      id: c.id,
      displayName: c.displayName,
      authType: c.authType,
      scopes: c.scopes,
      objectKinds: c.objectKinds,
    }));
  }
}
