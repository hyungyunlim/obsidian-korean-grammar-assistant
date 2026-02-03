import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

// Get default recommended rules and customize sentence-case
const rules = { ...obsidianmd.configs.recommended };

// Add project-specific brands to sentence-case rule
rules['obsidianmd/ui/sentence-case'] = ['error', {
  enforceCamelCaseLower: true,
  brands: [
    // Default brands from obsidianmd plugin
    'iOS', 'iPadOS', 'macOS', 'Windows', 'Android', 'Linux',
    'Obsidian', 'Obsidian Sync', 'Obsidian Publish',
    'Google Drive', 'Dropbox', 'OneDrive', 'iCloud Drive',
    'YouTube', 'Slack', 'Discord', 'Telegram', 'WhatsApp', 'Twitter', 'X',
    'Readwise', 'Zotero', 'Excalidraw', 'Mermaid',
    'Markdown', 'LaTeX', 'JavaScript', 'TypeScript', 'Node.js',
    'npm', 'pnpm', 'Yarn', 'Git', 'GitHub',
    'GitLab', 'Notion', 'Evernote', 'Roam Research', 'Logseq',
    'Anki', 'Reddit', 'VS Code', 'Visual Studio Code',
    'IntelliJ IDEA', 'WebStorm', 'PyCharm',
    // Project-specific brands
    'Bareun.ai', 'OpenAI', 'Anthropic', 'Google', 'Ollama',
    'Claude', 'Gemini', 'GPT', 'CodeMirror',
  ],
  acronyms: ['API', 'AI', 'URL', 'JSON', 'CSS', 'HTML', 'HTTP', 'HTTPS', 'LRU'],
  ignoreWords: ['Tab', 'Enter', 'Esc', 'Escape', 'Shift', 'Cmd', 'Ctrl', 'Alt', 'Space'],
  ignoreRegex: [
    '^(sk-|AIza|http|bareun-)',
    '^💡',
  ],
}];

export default tseslint.config(
  {
    files: ['**/*.ts'],
    plugins: {
      obsidianmd,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules,
  },
);
