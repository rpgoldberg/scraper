import * as grpc from '@grpc/grpc-js';
import type { handleUnaryCall } from '@grpc/grpc-js';
import type {
  ScrapeGenericRequest,
  ScrapeGenericResponse,
} from '../generated/figure_collector/v1/messages';
import { getGrpcEngineServices } from '../services';

/**
 * ScrapeGeneric — perform a generic page scrape with caller-supplied config.
 *
 * Maps the gRPC ScrapeConfig to the engine's ScrapePageOptions and delegates
 * to the ScrapingService adapter.
 */
export const scrapeGeneric: handleUnaryCall<ScrapeGenericRequest, ScrapeGenericResponse> = async (
  call,
  callback,
) => {
  try {
    const { url, config } = call.request;

    // Validate URL is present
    if (!url) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'URL is required',
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'Invalid URL format',
      });
    }

    const services = getGrpcEngineServices();
    if (!services) {
      return callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Engine services not initialized',
      });
    }

    // Map gRPC ScrapeConfig to engine ScrapePageOptions
    const scrapeOptions = config
      ? {
          cookies: config.cookies && Object.keys(config.cookies).length > 0
            ? config.cookies
            : undefined,
          cookieDomain: config.cookieDomain || undefined,
          waitForSelector: config.waitForSelector || undefined,
          timeout: config.timeoutMs || undefined,
          stealth: config.stealth || undefined,
          userAgent: config.userAgent || undefined,
        }
      : undefined;

    const result = await services.scraping.scrapeGeneric(url, scrapeOptions);

    callback(null, {
      success: true,
      data: result as { [key: string]: any },
      errorMessage: '',
    });
  } catch (error: any) {
    const message = error?.message || 'Scraping failed';

    // Map known error patterns to appropriate gRPC status codes
    if (message.includes('timeout') || message.includes('TIMEOUT')) {
      return callback({
        code: grpc.status.DEADLINE_EXCEEDED,
        message,
      });
    }

    callback(null, {
      success: false,
      data: undefined,
      errorMessage: message,
    });
  }
};
