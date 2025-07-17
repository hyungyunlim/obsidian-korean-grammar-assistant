# Korean Grammar Assistant

An advanced Korean grammar and spelling checker plugin for Obsidian, powered by Bareun.ai API. This plugin provides comprehensive Korean text correction with modern UI/UX features.

## ✨ Features

### Core Functionality
- **Advanced Grammar & Spelling Check**: Powered by Bareun.ai's state-of-the-art Korean language processing
- **Interactive Correction Interface**: Click-to-cycle through corrections (Error → Suggestions → Keep Original)
- **Real-time Preview**: See corrections applied instantly with color-coded status
- **Multi-suggestion Support**: Multiple correction options for each detected error

### Modern UI/UX
- **Smart Pagination**: Dynamic page sizing based on screen space and content
- **Mobile Optimized**: Touch-friendly interface with Safe Area support for iPhone notches
- **Responsive Design**: Adapts seamlessly to different screen sizes
- **Color-coded Status**: Visual indicators for errors (red), corrections (green), and intentional originals (blue)
- **Large Modal Interface**: 1200x1000px workspace for comfortable editing

### Technical Highlights
- **Dynamic Page Calculation**: Automatically adjusts content per page based on available space
- **Smart Sentence Boundaries**: Intelligent text splitting at natural Korean sentence endings
- **Background Isolation**: Prevents cursor blinking and interaction issues on mobile
- **Error State Management**: Sophisticated 3-stage toggle system for correction states

## 🚀 Quick Start

### Prerequisites
1. **Bareun.ai Account**: Sign up at https://bareun.ai/
2. **API Key**: Obtain your personal API key from Bareun.ai dashboard
3. **API Server**: Choose between cloud service (recommended) or local Bareun.ai server

### Installation

#### Method 1: Manual Installation (Recommended)
1. Download or clone this repository
2. Run `npm install && npm run build`
3. Copy `main.js`, `manifest.json`, `styles.css` to your Obsidian vault's `.obsidian/plugins/korean-grammar-assistant/` folder
4. Enable the plugin in Obsidian settings

#### Method 2: BRAT Plugin
1. Install BRAT plugin in Obsidian
2. Add this repository URL to BRAT
3. Install and enable Korean Grammar Assistant

### Configuration

1. **Enable the Plugin**: Go to Settings → Community Plugins → Korean Grammar Assistant → Enable
2. **Configure API Settings**: Navigate to Settings → Korean Grammar Assistant and configure:

- **API Key (Required)**: Your personal Bareun.ai API key 
  - Format: `koba-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX`
  - Get yours at: https://bareun.ai/
- **API Host**: 
  - Cloud service (recommended): `bareun-api.junlim.org`
  - Local server: `localhost`
- **API Port**: 
  - Cloud service: `443` (HTTPS)
  - Local server: `5655`

⚠️ **Important**: Each user must obtain their own API key from Bareun.ai. The plugin will not work without a valid API key.

## 📱 Usage

### Basic Workflow
1. **Select Text**: Highlight Korean text you want to check
2. **Launch Checker**: Click ribbon icon or use Command Palette → "Check Spelling"
3. **Review Errors**: Examine detected issues in the preview pane
4. **Apply Corrections**: Click on highlighted errors to cycle through options:
   - **Red (Error)**: Original text with detected issues
   - **Green (Corrected)**: Applied correction
   - **Blue (Intentional)**: Intentionally kept original despite suggestions
5. **Finalize**: Click "Apply" to commit changes to your document

### Mobile Experience
- **Touch-Optimized**: Large touch targets and gesture-friendly interface
- **Safe Area Support**: Proper handling of iPhone notches and home indicators
- **Contextual UI**: Color legend and controls adapt to mobile layout
- **Background Lock**: Prevents accidental interactions with underlying content

### Advanced Features
- **Smart Pagination**: Long texts are automatically split into manageable pages
- **Error Summary**: Collapsible panel showing all detected issues with quick fixes
- **Batch Processing**: Apply multiple corrections efficiently
- **Undo Support**: Standard Obsidian undo/redo works with applied corrections

## 🎨 Interface Guide

### Color Coding
- 🔴 **Red**: Original text with detected errors
- 🟢 **Green**: Text with applied corrections
- 🔵 **Blue**: Original text intentionally preserved by user

### Navigation
- **Pagination**: For long texts, use Previous/Next buttons
- **Error Summary**: Toggle the bottom panel to see all errors at once
- **Dynamic Sizing**: Interface automatically adjusts to your screen and content

## 🛠️ Technical Architecture

### API Integration
- **Bareun.ai Integration**: Utilizes advanced Korean NLP models
- **Error Handling**: Graceful degradation for API issues
- **Caching**: Efficient request management

### Performance Optimizations
- **Dynamic Pagination**: Content-aware page sizing
- **Memory Efficient**: Processes content in manageable chunks
- **Responsive Rendering**: Smooth interactions across devices

### Mobile Engineering
- **CSS Containment**: Prevents layout thrashing
- **Hardware Acceleration**: Smooth animations and transitions
- **Stacking Context**: Proper z-index management for overlay content

## 🔧 Troubleshooting

### Common Issues

**API Connection Failed**
- Verify Bareun.ai server is running (if using local setup)
- Check network connectivity for cloud service
- Confirm API endpoint and port settings

**Authentication Error**
- Validate API key format and permissions
- Ensure API key is active and not expired

**Mobile Interface Issues**
- Clear browser cache if using Obsidian web
- Ensure latest plugin version
- Check for conflicting plugins

**Performance Issues**
- Consider shorter text selections for very long documents
- Check available system memory
- Verify API server performance

### Debug Mode
Enable developer console to see detailed logging:
- Plugin initialization
- API requests and responses
- Pagination calculations
- Error processing details

## 🤝 Contributing

This project welcomes contributions! Areas of interest:
- Additional Korean language processing features
- UI/UX improvements
- Performance optimizations
- Mobile experience enhancements
- Documentation improvements

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- **Bareun.ai**: Providing excellent Korean language processing API
- **Obsidian Community**: Inspiration and feedback for plugin development
- **Original Plugin**: Based on concepts from x1brn/obsidian-korean-spellchecker

---

## 📊 Project Stats

- **Language**: TypeScript, CSS3
- **Platform**: Obsidian Desktop & Mobile
- **API**: Bareun.ai Korean Language Processing
- **UI Framework**: Vanilla CSS with modern features
- **Bundle Size**: Optimized for fast loading

**Made with ❤️ for the Korean Obsidian community**