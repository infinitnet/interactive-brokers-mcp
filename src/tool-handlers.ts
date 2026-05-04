import { IBClient } from "./ib-client.js";
import { IBGatewayManager } from "./gateway-manager.js";
import { HeadlessAuthenticator, HeadlessAuthConfig } from "./headless-auth.js";
import open from "open";
import { Logger } from "./logger.js";
import { FlexQueryClient } from "./flex-query-client.js";
import { FlexQueryStorage } from "./flex-query-storage.js";
import {
  AuthenticateInput,
  GetAccountInfoInput,
  GetPositionsInput,
  GetMarketDataInput,
  PlaceOrderInput,
  GetOrderStatusInput,
  GetLiveOrdersInput,
  ConfirmOrderInput,
  GetAlertsInput,
  CreateAlertInput,
  ActivateAlertInput,
  DeleteAlertInput,
  GetFlexQueryInput,
  ListFlexQueriesInput,
  ForgetFlexQueryInput,
} from "./tool-definitions.js";

export interface ToolHandlerContext {
  ibClient: IBClient;
  gatewayManager?: IBGatewayManager;
  config: any;
  flexQueryClient?: FlexQueryClient;
  flexQueryStorage?: FlexQueryStorage;
}

export type ToolHandlerResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

export class ToolHandlers {
  private context: ToolHandlerContext;

  constructor(context: ToolHandlerContext) {
    this.context = context;
    
    // Initialize flex query client and storage if token is provided
    // Only initialize if not already set (useful for testing)
    if (context.config.IB_FLEX_TOKEN && !context.flexQueryClient) {
      this.context.flexQueryClient = new FlexQueryClient({
        token: context.config.IB_FLEX_TOKEN,
      });
    }
    
    if (context.config.IB_FLEX_TOKEN && !context.flexQueryStorage) {
      this.context.flexQueryStorage = new FlexQueryStorage();
      // Initialize storage asynchronously
      this.context.flexQueryStorage.initialize().catch((error) => {
        Logger.error("[FLEX-QUERY] Failed to initialize storage:", error);
      });
    }
  }

  // Ensure Gateway is ready before operations
  private async ensureGatewayReady(): Promise<void> {
    if (this.context.gatewayManager) {
      await this.context.gatewayManager.ensureGatewayReady();
    }
  }

  // Authentication management
  private async ensureAuth(): Promise<void> {
    // Ensure Gateway is ready first
    await this.ensureGatewayReady();
    
    // Check if already authenticated
    const isAuthenticated = await this.context.ibClient.checkAuthenticationStatus();
    if (isAuthenticated) {
      return; // Already authenticated
    }

    // If in headless mode, start automatic headless authentication
    if (this.context.config.IB_HEADLESS_MODE) {
      const port = this.context.gatewayManager 
        ? this.context.gatewayManager.getCurrentPort() 
        : this.context.config.IB_GATEWAY_PORT;
      const authUrl = `https://${this.context.config.IB_GATEWAY_HOST}:${port}`;
      
      // Validate that we have credentials for headless mode
      if (!this.context.config.IB_USERNAME || !this.context.config.IB_PASSWORD_AUTH) {
        throw new Error("Headless mode enabled but authentication credentials missing. Please set IB_USERNAME and IB_PASSWORD_AUTH environment variables.");
      }

      const authConfig: HeadlessAuthConfig = {
        url: authUrl,
        username: this.context.config.IB_USERNAME,
        password: this.context.config.IB_PASSWORD_AUTH,
        timeout: this.context.config.IB_AUTH_TIMEOUT,
        ibClient: this.context.ibClient, // Pass the IB client for authentication checking
        paperTrading: this.context.config.IB_PAPER_TRADING,
      };

      const authenticator = new HeadlessAuthenticator();
      const result = await authenticator.authenticate(authConfig);

      if (!result.success) {
        throw new Error(`Authentication failed: ${result.message}`);
      }
    } else {
      // In non-headless mode, throw an error asking user to authenticate manually
      const port = this.context.gatewayManager 
        ? this.context.gatewayManager.getCurrentPort() 
        : this.context.config.IB_GATEWAY_PORT;
      const authUrl = `https://${this.context.config.IB_GATEWAY_HOST}:${port}`;
      throw new Error(`Authentication required. Please use the 'authenticate' tool to complete the authentication process at ${authUrl}.`);
    }
  }

  // Helper function to check for authentication errors
  private isAuthenticationError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message || error.toString();
    const errorStatus = error.response?.status;
    const responseData = error.response?.data;
    
    return (
      errorStatus === 401 ||
      errorStatus === 403 ||
      errorStatus === 500 ||
      errorMessage.includes("authentication") ||
      errorMessage.includes("unauthorized") ||
      errorMessage.includes("not authenticated") ||
      errorMessage.includes("login") ||
      responseData?.error === "not authenticated"
    );
  }

  private getAuthenticationErrorMessage(): string {
    const port = this.context.gatewayManager 
      ? this.context.gatewayManager.getCurrentPort() 
      : this.context.config.IB_GATEWAY_PORT;
    const authUrl = `https://${this.context.config.IB_GATEWAY_HOST}:${port}`;
    const mode = this.context.config.IB_HEADLESS_MODE ? "headless mode" : "browser mode";
    return `Authentication required. Please use the 'authenticate' tool to complete the authentication process (configured for ${mode}) at ${authUrl}.`;
  }

  private formatError(error: unknown): string {
    if (this.isAuthenticationError(error)) {
      return this.getAuthenticationErrorMessage();
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error: ${errorMessage}`;
  }

  async authenticate(input: AuthenticateInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      const port = this.context.gatewayManager 
        ? this.context.gatewayManager.getCurrentPort() 
        : this.context.config.IB_GATEWAY_PORT;
      const authUrl = `https://${this.context.config.IB_GATEWAY_HOST}:${port}`;
      
      // Check if headless mode is enabled in config
      if (this.context.config.IB_HEADLESS_MODE) {
        try {
          // Use headless authentication
          const authConfig: HeadlessAuthConfig = {
            url: authUrl,
            username: this.context.config.IB_USERNAME,
            password: this.context.config.IB_PASSWORD_AUTH,
            timeout: this.context.config.IB_AUTH_TIMEOUT,
          };

          // Validate that we have credentials for headless mode
          if (!authConfig.username || !authConfig.password) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    message: "Headless mode enabled but authentication credentials missing",
                    error: "Please set IB_USERNAME and IB_PASSWORD_AUTH environment variables for headless authentication",
                    authUrl: authUrl,
                    instructions: [
                      "Set environment variables: IB_USERNAME and IB_PASSWORD_AUTH",
                      "Or disable headless mode by setting IB_HEADLESS_MODE=false",
                      "Then try authentication again"
                    ]
                  }, null, 2),
                },
              ],
            };
          }

          const authenticator = new HeadlessAuthenticator();
          const result = await authenticator.authenticate(authConfig);

          // Authentication completed (success or failure) - no separate 2FA handling needed
          await authenticator.close();
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ...result,
                  authUrl: authUrl,
                  mode: "headless",
                  note: "Headless authentication completed automatically"
                }, null, 2),
              },
            ],
          };

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  message: "Headless authentication failed, falling back to manual browser authentication",
                  error: errorMessage,
                  authUrl: authUrl,
                  mode: "fallback_to_manual",
                  note: "Opening browser for manual authentication..."
                }, null, 2),
              },
            ],
          };
        }
      }
      
      // Original browser-based authentication (when headless mode is disabled or as fallback)
      try {
        await open(authUrl);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "Interactive Brokers authentication interface opened in your browser",
                authUrl: authUrl,
                mode: "browser",
                instructions: [
                  "1. The authentication page has been opened in your default browser",
                  "2. Accept any SSL certificate warnings (this is normal for localhost)",
                  "3. Complete the authentication process in the IB Gateway web interface",
                  "4. Log in with your Interactive Brokers credentials",
                  "5. Once authenticated, you can use other trading tools"
                ],
                browserOpened: true,
                note: "IB Gateway is running locally - your credentials stay secure on your machine"
              }, null, 2),
            },
          ],
        };
      } catch (browserError) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "Opening Interactive Brokers authentication interface...",
                authUrl: authUrl,
                mode: "manual",
                instructions: [
                  "1. Open the authentication URL below in your browser:",
                  `   ${authUrl}`,
                  "2. Accept any SSL certificate warnings (this is normal for localhost)",
                  "3. Complete the authentication process",
                  "4. Log in with your Interactive Brokers credentials",
                  "5. Once authenticated, you can use other trading tools"
                ],
                browserOpened: false,
                note: "Please open the URL manually. IB Gateway is running locally."
              }, null, 2),
            },
          ],
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async getAccountInfo(input: GetAccountInfoInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.getAccountInfo();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async getPositions(input: GetPositionsInput): Promise<ToolHandlerResult> {
    try {
      if (!input.accountId) {
        return {
          content: [
            {
              type: "text",
              text: "Account ID is required",
            },
          ],
        };
      }
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.getPositions(input.accountId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async getMarketData(input: GetMarketDataInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.getMarketData(input.symbol, input.exchange);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async placeOrder(input: PlaceOrderInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.placeOrder({
        accountId: input.accountId,
        symbol: input.symbol,
        action: input.action,
        orderType: input.orderType,
        quantity: input.quantity, // Already converted by Zod schema
        price: input.price,
        stopPrice: input.stopPrice,
        suppressConfirmations: input.suppressConfirmations,
        exchange: input.exchange,
        tif: input.tif,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async getOrderStatus(input: GetOrderStatusInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.getOrderStatus(input.orderId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async getLiveOrders(input: GetLiveOrdersInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      // Pass accountId as query parameter if provided
      const result = await this.context.ibClient.getOrders(input.accountId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async confirmOrder(input: ConfirmOrderInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.confirmOrder(input.replyId, input.messageIds);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async getAlerts(input: GetAlertsInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.getAlerts(input.accountId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async createAlert(input: CreateAlertInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.createAlert(input.accountId, input.alertRequest);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async activateAlert(input: ActivateAlertInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.activateAlert(input.accountId, input.alertId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async deleteAlert(input: DeleteAlertInput): Promise<ToolHandlerResult> {
    try {
      // Ensure Gateway is ready
      await this.ensureGatewayReady();
      
      // Ensure authentication in headless mode
      if (this.context.config.IB_HEADLESS_MODE) {
        await this.ensureAuth();
      }
      
      const result = await this.context.ibClient.deleteAlert(input.accountId, input.alertId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  // ── Flex Query Methods ──────────────────────────────────────────────────────

  async getFlexQuery(input: GetFlexQueryInput): Promise<ToolHandlerResult> {
    try {
      if (!this.context.flexQueryClient) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Flex Query feature not configured",
                message: "Please set the IB_FLEX_TOKEN environment variable to use Flex Queries",
                instructions: [
                  "1. Get your Flex Web Service Token from Interactive Brokers",
                  "2. Set the IB_FLEX_TOKEN environment variable",
                  "3. Restart the MCP server"
                ]
              }, null, 2),
            },
          ],
        };
      }

      if (!this.context.flexQueryStorage) {
        throw new Error("Flex Query storage not initialized");
      }

      Logger.log(`[FLEX-QUERY] Executing flex query: ${input.queryId}`);

      // Check if this query was used before (by IB's query ID)
      const existingQuery = await this.context.flexQueryStorage.getQueryByQueryId(input.queryId);
      
      // Execute the query
      const result = await this.context.flexQueryClient.executeQuery(input.queryId);

      if (result.error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: result.error,
                errorCode: result.errorCode,
                queryId: input.queryId,
              }, null, 2),
            },
          ],
        };
      }

      // Parse XML to extract query name from the response
      let parsedData;
      let queryNameFromApi: string | undefined;
      
      if (result.data) {
        try {
          parsedData = await this.context.flexQueryClient.parseStatement(result.data);
          
          // Extract query name from the parsed XML
          // The queryName is directly under FlexQueryResponse
          if (parsedData?.FlexQueryResponse) {
            queryNameFromApi = parsedData.FlexQueryResponse.queryName;
          }
          
          Logger.log(`[FLEX-QUERY] Extracted query name from API: ${queryNameFromApi}`);
        } catch (parseError) {
          Logger.warn("[FLEX-QUERY] Failed to parse XML for query name extraction:", parseError);
        }
      }

      // Auto-save the query if it's new or update last used
      if (existingQuery) {
        await this.context.flexQueryStorage.markQueryUsed(existingQuery.id);
        Logger.log(`[FLEX-QUERY] Updated last used timestamp for query: ${input.queryId}`);
      } else {
        // Save new query with the name from API, input, or fallback to queryId
        const queryName = queryNameFromApi || input.queryName || input.queryId;
        await this.context.flexQueryStorage.saveQuery({
          name: queryName,
          queryId: input.queryId,
          description: `Auto-saved on ${new Date().toLocaleDateString()}`,
        });
        Logger.log(`[FLEX-QUERY] Auto-saved new query: ${queryName}`);
      }

      // Return parsed data if requested (and we haven't parsed it yet)
      if (input.parseXml && !parsedData && result.data) {
        try {
          parsedData = await this.context.flexQueryClient.parseStatement(result.data);
        } catch (parseError) {
          Logger.warn("[FLEX-QUERY] Failed to parse XML, returning raw data:", parseError);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              queryId: input.queryId,
              queryName: queryNameFromApi,
              autoSaved: !existingQuery,
              data: parsedData || result.data,
              note: existingQuery 
                ? "Query was previously saved and has been marked as used" 
                : "Query has been automatically saved for future reference"
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async listFlexQueries(input: ListFlexQueriesInput): Promise<ToolHandlerResult> {
    try {
      if (!this.context.flexQueryStorage) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Flex Query feature not configured",
                message: "Please set the IB_FLEX_TOKEN environment variable to use Flex Queries"
              }, null, 2),
            },
          ],
        };
      }

      const queries = await this.context.flexQueryStorage.listQueries();
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: queries.length,
              queries: queries.map(q => ({
                name: q.name,
                queryId: q.queryId,
                description: q.description,
                createdAt: q.createdAt,
                lastUsed: q.lastUsed,
              })),
              storageLocation: this.context.flexQueryStorage.getStorageFilePath(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }

  async forgetFlexQuery(input: ForgetFlexQueryInput): Promise<ToolHandlerResult> {
    try {
      if (!this.context.flexQueryStorage) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Flex Query feature not configured",
                message: "Please set the IB_FLEX_TOKEN environment variable to use Flex Queries"
              }, null, 2),
            },
          ],
        };
      }

      // Try to find the query by IB's queryId first, then by name as fallback
      let query = await this.context.flexQueryStorage.getQueryByQueryId(input.queryId);
      
      if (!query) {
        // Try to find by name as fallback (in case user provides a friendly name)
        query = await this.context.flexQueryStorage.getQueryByName(input.queryId);
      }

      if (!query) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Query not found",
                message: `No saved query found with ID: ${input.queryId}`,
                suggestion: "Use list_flex_queries to see all saved queries"
              }, null, 2),
            },
          ],
        };
      }

      const deleted = await this.context.flexQueryStorage.deleteQuery(query.id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: deleted,
              message: deleted 
                ? `Query "${query.name}" (${query.queryId}) has been forgotten` 
                : "Failed to delete query",
              queryId: input.queryId,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: this.formatError(error),
          },
        ],
      };
    }
  }
}