/**
 * RPA Engine types.
 * Types for no-code automation scripts, actions, and templates.
 */
/** An RPA automation script definition. */
export interface RPAScript {
    id?: string;
    name: string;
    actions: RPAAction[];
    errorHandling: 'stop' | 'skip' | 'retry';
    maxRetries?: number;
}
/** A single action block within an RPA script. */
export interface RPAAction {
    type: 'navigate' | 'click' | 'type' | 'wait' | 'scroll' | 'screenshot';
    selector?: string;
    value?: string;
    timeout?: number;
}
/** Result of executing an RPA script. */
export interface RPAExecutionResult {
    success: boolean;
    actionsCompleted: number;
    totalActions: number;
    errors: RPAError[];
}
/** Error details for a failed RPA action. */
export interface RPAError {
    actionIndex: number;
    action: RPAAction;
    message: string;
    timestamp: string;
}
/** A pre-built automation template for a specific platform. */
export interface RPATemplate {
    id: string;
    name: string;
    platform: 'facebook' | 'amazon' | 'tiktok';
    description: string;
}
//# sourceMappingURL=rpa.d.ts.map