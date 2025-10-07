/**
 * The base error class for all errors thrown by the EarnKit SDK.
 * This allows developers to catch all SDK-specific errors using `catch (e) { if (e instanceof EarnKitError) { ... } }`.
 */
export class EarnKitError extends Error {
	constructor(message: string) {
		super(`[EarnKitError] ${message}`);
		this.name = "EarnKitError";
	}
}

/**
 * Thrown when the SDK is not properly initialized before use,
 * or when initialization is attempted with invalid configuration.
 */ export class EarnKitInitializationError extends EarnKitError {
	constructor(message: string) {
		super(message);
		this.name = "EarnKitInitializationError";
	}
}

/**
 * Thrown when a method is called with invalid or missing parameters.
 * This error indicates a problem with the developer's input to the SDK method.
 */
export class EarnKitInputError extends EarnKitError {
	constructor(message: string) {
		super(message);
		this.name = "EarnKitInputError";
	}
}

/**
 * Thrown when an API call to the EarnKit backend fails.
 * It contains the HTTP status code and the response body for debugging.
 */
export class EarnKitApiError extends EarnKitError {
	public readonly status: number;
	public readonly responseBody: unknown;

	constructor(message: string, status: number, responseBody: unknown = null) {
		super(`API Error: ${message}`);
		this.name = "EarnKitApiError";
		this.status = status;
		this.responseBody = responseBody;
	}
}
