export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
};

export type ImageResponseMetadata = {
    id?: string;
    model?: string;
    created?: number | string;
    quality?: string;
    size?: string;
    revisedPrompt?: string;
    finishReason?: string;
    usage?: Record<string, number>;
};

export type GeneratedImageResult = {
    id: string;
    dataUrl: string;
    response?: ImageResponseMetadata;
};
