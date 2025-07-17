# Korean Grammar Assistant

An advanced Korean grammar and spelling checker plugin for Obsidian, powered by Bareun.ai and various AI providers. This plugin provides comprehensive Korean text correction with modern UI/UX features.

## ✨ Features

### Core Functionality
- **Advanced Grammar & Spelling Check**: Powered by Bareun.ai's state-of-the-art Korean language processing.
- **AI-Powered Corrections**: Integrates with OpenAI, Anthropic (Claude), Google (Gemini), and Ollama for intelligent, context-aware suggestions.
- **Interactive Correction Interface**: Click-to-cycle through corrections (Error → Suggestions → Keep Original).
- **Real-time Preview**: See corrections applied instantly with color-coded status.
- **Multi-suggestion Support**: Multiple correction options for each detected error.

### Modern UI/UX
- **Smart Pagination**: Dynamic page sizing based on screen space and content.
- **Mobile Optimized**: Touch-friendly interface with Safe Area support for iPhone notches.
- **Responsive Design**: Adapts seamlessly to different screen sizes.
- **Color-coded Status**: Visual indicators for errors (red), corrections (green), and intentional originals (orange).
- **Large Modal Interface**: A spacious workspace for comfortable editing.

### AI-Specific Features
- **Multiple AI Providers**: Choose from OpenAI, Anthropic, Google, or a local Ollama instance.
- **Intelligent Analysis**: AI considers the full context to provide the best correction.
- **Confidence Scores**: Each AI suggestion comes with a confidence score (0-100%).
- **Detailed Reasoning**: Understand *why* the AI chose a particular correction.
- **Automatic Exception Handling**: AI can identify and preserve proper nouns, URLs, and technical terms.
- **One-Click Application**: Review the AI's suggestions and apply them with a single click.

## 🚀 Quick Start

### Prerequisites
1. **Bareun.ai Account**: Sign up at [https://bareun.ai/](https://bareun.ai/) for the base grammar check.
2. **API Key**: Obtain your personal API key from the Bareun.ai dashboard.
3. **(Optional) AI Provider Account**: For AI features, you'll need an API key from OpenAI, Anthropic, or Google, or a running Ollama instance.

### Installation

#### Method 1: Manual Installation (Recommended)
1. Download or clone this repository.
2. Run `npm install && npm run build`.
3. Copy `main.js`, `manifest.json`, and `styles.css` to your Obsidian vault's `.obsidian/plugins/korean-grammar-assistant/` folder.
4. Enable the plugin in Obsidian settings.

#### Method 2: BRAT Plugin
1. Install the BRAT plugin in Obsidian.
2. Add this repository's URL to BRAT.
3. Install and enable the Korean Grammar Assistant.

### Configuration

1. **Enable the Plugin**: Go to `Settings` → `Community Plugins` → `Korean Grammar Assistant` → `Enable`.
2. **Configure API Settings**: Navigate to `Settings` → `Korean Grammar Assistant`.
    - **Bareun.ai API Key (Required)**: Your personal Bareun.ai API key.
    - **AI Provider (Optional)**: Select your preferred AI provider and enter the corresponding API key or endpoint.

## 📱 Usage

### Basic Workflow
1. **Select Text**: Highlight the Korean text you want to check.
2. **Launch Checker**: Click the ribbon icon or use the Command Palette → "Check Spelling".
3. **Review Errors**: Examine the detected issues in the preview pane.
4. **Apply Corrections**: Click on highlighted errors to cycle through options.
5. **Finalize**: Click "Apply" to commit changes to your document.

### AI-Powered Workflow
1. **Perform Basic Check**: Follow the basic workflow above.
2. **Run AI Analysis**: Click the "🤖 AI 분석" button in the popup header.
3. **Review AI Suggestions**: The AI will automatically select the best corrections. Review the confidence scores and reasoning.
4. **Apply**: Click "Apply" to save the AI-powered corrections.

## 🎨 Interface Guide

### Color Coding
- 🔴 **Red**: Original text with detected errors.
- 🟢 **Green**: Text with applied corrections.
- 🔵 **Blue**: Original text intentionally preserved by the user (exception).
- 🟠 **Orange**: Original text kept by the user.

## 🛠️ Technical Architecture

- **Frontend**: TypeScript, CSS3, Obsidian API
- **Backend**: Bareun.ai API, OpenAI API, Anthropic API, Google API, Ollama API
- **Build Tool**: ESBuild

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue.

## 📄 License

MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- **Bareun.ai**: For their excellent Korean language processing API.
- **Obsidian Community**: For their inspiration and feedback.
