import type {BrowserContext, TestType} from '@playwright/test';
export interface TemplateCoverageOptions {
    outputDir?: string;
    metadata?: Record<string, unknown>;
}
export function registerTemplateCoverage(context: BrowserContext, options?: TemplateCoverageOptions): Promise<{
    flush(): Promise<void>;
    stop(): Promise<string | undefined>;
}>;
export function withTemplateCoverage<T extends {}, W extends {}>(test: TestType<T, W>, options?: TemplateCoverageOptions): TestType<T & {templateCoverageOptions: TemplateCoverageOptions}, W>;
