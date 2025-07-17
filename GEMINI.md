# Korean Grammar Assistant (Gemini version)

This document outlines the functionality and implementation of the Korean Grammar Assistant, an Obsidian plugin that helps users correct Korean grammar in their notes.

## Introduction

The Korean Grammar Assistant is an Obsidian plugin designed to enhance the writing process for users who write in Korean. It leverages the power of the Gemini API to provide real-time grammar correction and suggestions. By simply selecting a piece of text, users can get instant feedback on their writing, helping them to improve accuracy and fluency.

## Features

-   **Real-time Grammar Correction**: Select any Korean text in your editor and get instant grammar corrections.
-   **Detailed Explanations**: Understand the reasoning behind each correction with detailed explanations.
-   **Confidence Score**: Each suggestion comes with a confidence score, helping you decide whether to accept the correction.
-   **User-friendly Interface**: The plugin integrates seamlessly into the Obsidian UI, with a simple popup for displaying corrections.
-   **Customizable Settings**: Users can configure the plugin's behavior, such as setting ignored words.

## How it works

When a user selects a piece of text and triggers the plugin, the following steps occur:

1.  **Text Selection**: The user selects a portion of Korean text in the Obsidian editor.
2.  **API Request**: The selected text is sent to the Gemini API along with a carefully crafted prompt.
3.  **Prompt Engineering**: The prompt instructs Gemini to act as a Korean grammar expert and provide corrections in a structured JSON format.

Here is an example of the prompt sent to Gemini:

> You are an expert in Korean grammar. Please correct the grammar of the following text: `{{selectedText}}`.
>
> Please provide your response in the following JSON format:
>
> ```json
> {
>   "corrected_text": "The corrected version of the text.",
>   "explanation": "A detailed explanation of the corrections made.",
>   "confidence_level": "A score from 0 to 1 indicating your confidence in the correction."
> }
> ```
>
> For example, if the input text is "저는 학교를 갑니다.", your response should be:
>
> ```json
> {
>   "corrected_text": "저는 학교에 갑니다.",
>   "explanation": "'를' is an object marker, but '학교' in this context is a destination, so the location marker '에' is more appropriate.",
>   "confidence_level": "0.95"
> }
> ```

4.  **Response Handling**: The plugin parses the JSON response from the API.
5.  **UI Display**: The corrected text, explanation, and confidence level are displayed in a user-friendly popup within Obsidian.
6.  **User Action**: The user can then choose to accept the correction, which replaces the original text, or dismiss the popup.

## API

The plugin uses the `@google/generative-ai` library to interact with the Gemini API. The API key is stored securely using Obsidian's local storage.

Here is a simplified example of how the API is called:

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI("YOUR_API_KEY"); // Your API key will be supplied by the user

async function run() {
  // For text-only input, use the gemini-pro model
  const model = genAI.getGenerativeModel({ model: "gemini-pro"});

  const prompt = "Hello, world";

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();
  console.log(text);
}

run();
```

## Privacy

The privacy of user data is a top priority. The selected text is sent to the Gemini API for processing, but it is not stored or used for any other purpose. The API key is stored locally on the user's machine and is never transmitted to any third-party servers other than the Gemini API.

## Future Plans

-   [ ] Support for correcting longer documents.
-   [ ] Integration with other language models.
-   [ ] Customizable prompts.
-   [ ] Batch processing of files.
