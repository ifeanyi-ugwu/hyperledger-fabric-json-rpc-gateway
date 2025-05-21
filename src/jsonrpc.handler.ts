import { Signer } from "@hyperledger/fabric-gateway";
import WebSocket from "ws";
import { FabricService } from "./fabric.service";

interface EventSubscription {
  closeListener: () => void;
}

export class JsonRpcHandler {
  private subscriptions: Record<string, EventSubscription> = {};

  constructor(private ws: WebSocket) {}

  /**
   * send JSON-RPC responses
   */
  sendResponse(id: string, result: any): void {
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        result,
        id,
      })
    );
  }

  /**
   * send JSON-RPC errors
   */
  sendError(
    id: string | null,
    code: number,
    message: string,
    data?: any
  ): void {
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code,
          message,
          data: data
            ? {
                message: data.message,
                stack:
                  process.env.NODE_ENV === "development"
                    ? data.stack
                    : undefined,
              }
            : undefined,
        },
        id,
      })
    );
  }

  /**
   * send JSON-RPC notifications (no ID)
   */
  sendNotification(method: string, params: any): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method,
          params,
        })
      );
    }
  }

  async processMessage(msgData: string): Promise<void> {
    let msg;
    try {
      msg = JSON.parse(msgData);
    } catch {
      this.sendError(null, -32700, "Invalid JSON");
      return;
    }

    if (msg.method) {
      if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
        this.sendError(msg.id || null, -32600, "Invalid Request");
        return;
      }

      try {
        switch (msg.method) {
          case "fabric_evaluateTransaction":
            await this.handleEvaluateTransaction(msg.id, msg.params || {});
            break;
          case "fabric_submitTransaction":
            await this.handleSubmitTransaction(msg.id, msg.params || {});
            break;
          case "fabric_submitAsync":
            await this.handleSubmitAsync(msg.id, msg.params || {});
            break;
          case "fabric_subscribe":
            await this.handleSubscribe(msg.id, msg.params || {});
            break;
          case "fabric_unsubscribe":
            await this.handleUnsubscribe(msg.id, msg.params || {});
            break;
          default:
            this.sendError(msg.id, -32601, "Method not found");
        }
      } catch (err) {
        console.error(`Error handling method ${msg.method}:`, err);
        this.sendError(msg.id, -32000, `Error handling ${msg.method}`, err);
      }
    } else if (msg.result || msg.error) {
      // Handle response here if needed
    } else {
      this.sendError(null, -32600, "Invalid Request");
    }
  }

  cleanup(): void {
    Object.keys(this.subscriptions).forEach((subId) => {
      try {
        this.subscriptions[subId].closeListener();
        delete this.subscriptions[subId];
      } catch (err) {
        console.error(`Error cleaning up subscription ${subId}:`, err);
      }
    });
  }

  createSigner(certificate: string): Signer {
    return async (digest: Uint8Array): Promise<Uint8Array> => {
      const signature = await this.requestSignature(digest, certificate);
      if (!signature) {
        throw new Error("Signature not received");
      }
      return signature;
    };
  }

  /**
   * Requests a signature via WebSocket
   */
  private async requestSignature(
    digest: Uint8Array,
    certificate: string
  ): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const requestId = generateUniqueId();

      const handler = (rawMsg: WebSocket.RawData) => {
        try {
          const reply = JSON.parse(rawMsg.toString());
          if (
            reply.jsonrpc === "2.0" &&
            reply.id === requestId &&
            reply.result?.signature
          ) {
            this.ws.off("message", handler);
            resolve(
              Uint8Array.from(Buffer.from(reply.result.signature, "base64"))
            );
          }
        } catch {
          this.ws.off("message", handler);
          resolve(null);
        }
      };

      this.ws.on("message", handler);
      this.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "signDigest",
          params: {
            digest: Buffer.from(digest).toString("base64"),
            certificate,
          },
          id: requestId,
        })
      );
    });
  }

  // ===== method handlers ====

  private async handleEvaluateTransaction(
    id: string,
    params: any
  ): Promise<void> {
    const { identity, channel, chaincode, fn, args, peer } = params;

    const { name, endpoint, tlsRootCert } = peer || {};

    if (
      !this.validateRequiredParams(id, [
        identity?.certificate,
        identity?.mspId,
        channel,
        chaincode,
        fn,
        name,
        endpoint,
      ])
    ) {
      return;
    }

    const fabricIdentity = {
      mspId: identity.mspId,
      credentials: Buffer.from(identity.certificate),
    };

    const signer = this.createSigner(identity.certificate);

    try {
      const service = await FabricService.createForUser(
        fabricIdentity,
        signer,
        {
          name,
          endpoint,
          tlsRootCert,
        }
      );

      const chaincodeName =
        typeof chaincode === "string" ? chaincode : chaincode.name;
      const contractName =
        typeof chaincode === "object" ? chaincode.contract : undefined;

      const result = await service.evaluateTransaction({
        channelName: channel,
        chaincodeName,
        contractName,
        fn,
        args,
      });

      this.sendResponse(id, result);

      service.close();
    } catch (err) {
      console.error("Transaction error:", err);
      this.sendError(id, -32000, "Transaction failed", err);
    }
  }

  private async handleSubmitTransaction(
    id: string,
    params: any
  ): Promise<void> {
    const { identity, channel, chaincode, fn, args, peer } = params;

    const { name, endpoint, tlsRootCert } = peer || {};

    if (
      !this.validateRequiredParams(id, [
        identity?.certificate,
        identity?.mspId,
        channel,
        chaincode,
        fn,
        name,
        endpoint,
      ])
    ) {
      return;
    }

    const fabricIdentity = {
      mspId: identity.mspId,
      credentials: Buffer.from(identity.certificate),
    };

    const signer = this.createSigner(identity.certificate);

    try {
      const service = await FabricService.createForUser(
        fabricIdentity,
        signer,
        {
          name,
          endpoint,
          tlsRootCert,
        }
      );

      const chaincodeName =
        typeof chaincode === "string" ? chaincode : chaincode.name;
      const contractName =
        typeof chaincode === "object" ? chaincode.contract : undefined;

      const result = await service.submitTransaction({
        channelName: channel,
        chaincodeName,
        contractName,
        fn,
        args,
      });

      this.sendResponse(id, result);

      service.close();
    } catch (err) {
      console.error("Transaction submission error:", err);
      this.sendError(id, -32000, "Transaction submission failed", err);
    }
  }

  private async handleSubmitAsync(id: string, params: any): Promise<void> {
    const { identity, channel, chaincode, fn, args, peer } = params;

    const { name, endpoint, tlsRootCert } = peer || {};

    if (
      !this.validateRequiredParams(id, [
        identity?.certificate,
        identity?.mspId,
        channel,
        chaincode,
        fn,
        name,
        endpoint,
      ])
    ) {
      return;
    }

    const fabricIdentity = {
      mspId: identity.mspId,
      credentials: Buffer.from(identity.certificate),
    };

    const signer = this.createSigner(identity.certificate);

    try {
      const service = await FabricService.createForUser(
        fabricIdentity,
        signer,
        {
          name,
          endpoint,
          tlsRootCert,
        }
      );

      const chaincodeName =
        typeof chaincode === "string" ? chaincode : chaincode.name;
      const contractName =
        typeof chaincode === "object" ? chaincode.contract : undefined;

      const transactionId = await service.submitAsync({
        channelName: channel,
        chaincodeName,
        contractName,
        fn,
        args,
      });

      this.sendResponse(id, { transactionId });
    } catch (err) {
      console.error("Async transaction submission error:", err);
      this.sendError(id, -32000, "Async transaction submission failed", err);
    }
  }

  async handleSubscribe(id: string, params: any): Promise<void> {
    const { eventType } = params;

    if (!this.validateRequiredParams(id, [eventType])) {
      return;
    }

    try {
      switch (eventType) {
        case "chaincode":
          return this.handleSubscribeChaincodeEvents(id, params);
        case "block":
          return this.handleSubscribeBlockEvents(id, params);
        default:
          this.sendError(id, -32602, "Invalid params", {
            message: `Invalid eventType: ${eventType}. Supported types are 'chaincode' and 'block'.`,
          });
          return;
      }
    } catch (err) {
      console.error("Subscription error:", err);
      this.sendError(id, -32000, "Subscription failed", err);
    }
  }

  // ==== subscriptions handlers ====

  private async handleSubscribeChaincodeEvents(
    id: string,
    params: any
  ): Promise<void> {
    const { identity, channel, chaincode, peer } = params;

    const { name, endpoint, tlsRootCert } = peer || {};

    if (
      !this.validateRequiredParams(id, [
        identity?.certificate,
        identity?.mspId,
        channel,
        chaincode,
        name,
        endpoint,
      ])
    ) {
      return;
    }

    const fabricIdentity = {
      mspId: identity.mspId,
      credentials: Buffer.from(identity.certificate),
    };

    const signer = this.createSigner(identity.certificate);

    try {
      const service = await FabricService.createForUser(
        fabricIdentity,
        signer,
        {
          name,
          endpoint,
          tlsRootCert,
        }
      );

      const chaincodeName =
        typeof chaincode === "string" ? chaincode : chaincode.name;

      const eventsIterator = await service.subscribeToChaincodeEvents(
        channel,
        chaincodeName
      );
      const subscriptionId = generateUniqueId();

      const eventProcessor = async () => {
        try {
          for await (const event of eventsIterator) {
            this.sendNotification("fabric_subscription", {
              subscription: subscriptionId,
              result: {
                chaincodeName: event.chaincodeName,
                blockNumber: event.blockNumber.toString(),
                transactionId: event.transactionId,
                eventName: event.eventName,
                payload: Buffer.from(event.payload).toString("base64"),
              },
            });
          }
        } catch (err) {
          console.error("Event processing error:", err);
          this.sendNotification("fabric_subscription", {
            subscription: subscriptionId,
            result: {
              error: {
                message: "Event stream closed due to error",
              },
            },
          });
          // Clean up on error
          if (this.subscriptions[subscriptionId]) {
            this.subscriptions[subscriptionId].closeListener();
            delete this.subscriptions[subscriptionId];
          }
        } finally {
          // Clean up when the iterator is done (e.g., unsubscribed)
          if (this.subscriptions[subscriptionId]) {
            this.subscriptions[subscriptionId].closeListener();
            delete this.subscriptions[subscriptionId];
          }
        }
      };

      eventProcessor();

      this.subscriptions[subscriptionId] = {
        closeListener: () => {
          eventsIterator.close();
          service.close();
        },
      };

      this.sendResponse(id, subscriptionId);
    } catch (err) {
      console.error("Subscription error:", err);
      this.sendError(id, -32000, "Subscription failed", err);
    }
  }

  private async handleSubscribeBlockEvents(
    id: string,
    params: any
  ): Promise<void> {
    const { identity, channel, startBlock, peer } = params;

    const { name, endpoint, tlsRootCert } = peer || {};

    if (
      !this.validateRequiredParams(id, [
        identity?.certificate,
        identity?.mspId,
        channel,
        name,
        endpoint,
      ])
    ) {
      return;
    }

    const fabricIdentity = {
      mspId: identity.mspId,
      credentials: Buffer.from(identity.certificate),
    };

    const signer = this.createSigner(identity.certificate);

    try {
      const service = await FabricService.createForUser(
        fabricIdentity,
        signer,
        {
          name,
          endpoint,
          tlsRootCert,
        }
      );
      const options = startBlock ? { startBlock: BigInt(startBlock) } : {};
      const eventsIterator = await service.subscribeToBlockEvents(
        channel,
        options
      );
      const subscriptionId = generateUniqueId();

      const eventProcessor = async () => {
        try {
          for await (const block of eventsIterator) {
            const blockAsObject = block.toObject();
            const encodedBlock = encodeUint8ArraysToBase64(blockAsObject);

            this.sendNotification("fabric_subscription", {
              subscription: subscriptionId,
              result: {
                block: encodedBlock,
              },
            });
          }
        } catch (err) {
          console.error("Block event processing error:", err);
          this.sendNotification("fabric_subscription", {
            subscription: subscriptionId,
            result: {
              error: {
                message: "Event stream closed due to error",
              },
            },
          });
          // Clean up on error
          if (this.subscriptions[subscriptionId]) {
            this.subscriptions[subscriptionId].closeListener();
            delete this.subscriptions[subscriptionId];
          }
        } finally {
          // Clean up when the iterator is done (e.g., unsubscribed)
          if (this.subscriptions[subscriptionId]) {
            this.subscriptions[subscriptionId].closeListener();
            delete this.subscriptions[subscriptionId];
          }
        }
      };

      eventProcessor();

      this.subscriptions[subscriptionId] = {
        closeListener: () => {
          eventsIterator.close();
          service.close();
        },
      };

      this.sendResponse(id, subscriptionId);
    } catch (err) {
      console.error("Block subscription error:", err);
      this.sendError(id, -32000, "Block subscription failed", err);
    }
  }

  private cleanupSubscription(subscriptionId: string): void {
    if (this.subscriptions[subscriptionId]) {
      try {
        this.subscriptions[subscriptionId].closeListener();
        delete this.subscriptions[subscriptionId];
      } catch (err) {
        console.error(`Error cleaning up subscription ${subscriptionId}:`, err);
      }
    }
  }

  // === other method handlers ====

  private async handleUnsubscribe(id: string, params: any): Promise<void> {
    const { subscriptionId } = params;

    if (!this.validateRequiredParams(id, [subscriptionId])) {
      return;
    }

    if (this.subscriptions[subscriptionId]) {
      try {
        this.subscriptions[subscriptionId].closeListener();
        delete this.subscriptions[subscriptionId];
        this.sendResponse(id, true);
      } catch (err) {
        console.error("Unsubscribe error:", err);
        this.sendError(id, -32000, "Failed to unsubscribe", err);
      }
    } else {
      this.sendError(id, -32602, "Invalid params", {
        message: `Invalid subscriptionId: ${subscriptionId}`,
      });
    }
  }

  private validateRequiredParams(id: string, params: any[]): boolean {
    if (params.some((param) => param === undefined || param === null)) {
      this.sendError(id, -32602, "Invalid params", {
        message: "Missing required fields",
      });
      return false;
    }
    return true;
  }
}

function generateUniqueId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function encodeUint8ArraysToBase64(obj: any): any {
  if (obj instanceof Uint8Array) {
    return Buffer.from(obj).toString("base64");
  } else if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = encodeUint8ArraysToBase64(obj[key]);
      }
    }
    return newObj;
  }
  return obj;
}
