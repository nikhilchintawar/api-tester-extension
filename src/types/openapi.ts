/**
 * OpenAPI 3.0 Types
 * Following the official OpenAPI Specification 3.0.3
 * https://spec.openapis.org/oas/v3.0.3
 */

export interface OpenAPIDocument {
    openapi: '3.0.0' | '3.0.1' | '3.0.2' | '3.0.3';
    info: OpenAPIInfo;
    servers?: OpenAPIServer[];
    paths: OpenAPIPaths;
    components?: OpenAPIComponents;
    security?: OpenAPISecurityRequirement[];
    tags?: OpenAPITag[];
    externalDocs?: OpenAPIExternalDocs;
}

export interface OpenAPIInfo {
    title: string;
    version: string;
    description?: string;
    termsOfService?: string;
    contact?: {
        name?: string;
        url?: string;
        email?: string;
    };
    license?: {
        name: string;
        url?: string;
    };
}

export interface OpenAPIServer {
    url: string;
    description?: string;
    variables?: Record<string, OpenAPIServerVariable>;
}

export interface OpenAPIServerVariable {
    enum?: string[];
    default: string;
    description?: string;
}

export interface OpenAPIPaths {
    [path: string]: OpenAPIPathItem;
}

export interface OpenAPIPathItem {
    summary?: string;
    description?: string;
    get?: OpenAPIOperation;
    put?: OpenAPIOperation;
    post?: OpenAPIOperation;
    delete?: OpenAPIOperation;
    options?: OpenAPIOperation;
    head?: OpenAPIOperation;
    patch?: OpenAPIOperation;
    trace?: OpenAPIOperation;
    servers?: OpenAPIServer[];
    parameters?: OpenAPIParameter[];
}

export interface OpenAPIOperation {
    tags?: string[];
    summary?: string;
    description?: string;
    operationId?: string;
    parameters?: OpenAPIParameter[];
    requestBody?: OpenAPIRequestBody;
    responses: OpenAPIResponses;
    callbacks?: Record<string, OpenAPICallback>;
    deprecated?: boolean;
    security?: OpenAPISecurityRequirement[];
    servers?: OpenAPIServer[];

    // Extension fields for our API tester
    'x-response'?: OpenAPIResponseExample;
    'x-timestamp'?: number;
    'x-collection'?: string;
}

export interface OpenAPIParameter {
    name: string;
    in: 'query' | 'header' | 'path' | 'cookie';
    description?: string;
    required?: boolean;
    deprecated?: boolean;
    allowEmptyValue?: boolean;
    schema?: OpenAPISchema;
    example?: any;
    examples?: Record<string, OpenAPIExample>;
}

export interface OpenAPIRequestBody {
    description?: string;
    content: Record<string, OpenAPIMediaType>;
    required?: boolean;
}

export interface OpenAPIMediaType {
    schema?: OpenAPISchema;
    example?: any;
    examples?: Record<string, OpenAPIExample>;
    encoding?: Record<string, OpenAPIEncoding>;
}

export interface OpenAPISchema {
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    format?: string;
    title?: string;
    description?: string;
    default?: any;
    enum?: any[];
    items?: OpenAPISchema;
    properties?: Record<string, OpenAPISchema>;
    required?: string[];
    additionalProperties?: boolean | OpenAPISchema;
    example?: any;

    // Validation
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
}

export interface OpenAPIResponses {
    [statusCode: string]: OpenAPIResponse;
}

export interface OpenAPIResponse {
    description: string;
    headers?: Record<string, OpenAPIHeader>;
    content?: Record<string, OpenAPIMediaType>;
    links?: Record<string, OpenAPILink>;
}

export interface OpenAPIHeader {
    description?: string;
    required?: boolean;
    deprecated?: boolean;
    schema?: OpenAPISchema;
    example?: any;
}

export interface OpenAPIExample {
    summary?: string;
    description?: string;
    value?: any;
    externalValue?: string;
}

export interface OpenAPIEncoding {
    contentType?: string;
    headers?: Record<string, OpenAPIHeader>;
    style?: string;
    explode?: boolean;
    allowReserved?: boolean;
}

export interface OpenAPIComponents {
    schemas?: Record<string, OpenAPISchema>;
    responses?: Record<string, OpenAPIResponse>;
    parameters?: Record<string, OpenAPIParameter>;
    examples?: Record<string, OpenAPIExample>;
    requestBodies?: Record<string, OpenAPIRequestBody>;
    headers?: Record<string, OpenAPIHeader>;
    securitySchemes?: Record<string, OpenAPISecurityScheme>;
    links?: Record<string, OpenAPILink>;
    callbacks?: Record<string, OpenAPICallback>;
}

export interface OpenAPISecurityScheme {
    type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
    description?: string;
    name?: string;
    in?: 'query' | 'header' | 'cookie';
    scheme?: string;
    bearerFormat?: string;
    flows?: OpenAPIOAuthFlows;
    openIdConnectUrl?: string;
}

export interface OpenAPIOAuthFlows {
    implicit?: OpenAPIOAuthFlow;
    password?: OpenAPIOAuthFlow;
    clientCredentials?: OpenAPIOAuthFlow;
    authorizationCode?: OpenAPIOAuthFlow;
}

export interface OpenAPIOAuthFlow {
    authorizationUrl?: string;
    tokenUrl?: string;
    refreshUrl?: string;
    scopes: Record<string, string>;
}

export interface OpenAPISecurityRequirement {
    [name: string]: string[];
}

export interface OpenAPILink {
    operationRef?: string;
    operationId?: string;
    parameters?: Record<string, any>;
    requestBody?: any;
    description?: string;
    server?: OpenAPIServer;
}

export interface OpenAPICallback {
    [expression: string]: OpenAPIPathItem;
}

export interface OpenAPITag {
    name: string;
    description?: string;
    externalDocs?: OpenAPIExternalDocs;
}

export interface OpenAPIExternalDocs {
    description?: string;
    url: string;
}

// Extension: Stored response data
export interface OpenAPIResponseExample {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    time: number;
    size: number;
    timestamp: number;
}

// Helper type for converting our current format to OpenAPI
export interface APITesterCollection {
    document: OpenAPIDocument;
    metadata: {
        createdAt: number;
        updatedAt: number;
        version: string;
    };
}
