import {
  Plugin,
  Notice,
  EditorPosition,
  Editor,
  addIcon,
  MarkdownView,
  PluginSettingTab,
  App,
  Setting,
} from "obsidian";

interface Correction {
  original: string;
  corrected: string[];
  help: string;
}

// Bareun.ai API 설정
interface PluginSettings {
  apiKey: string;
  apiHost: string;
  apiPort: number;
  ignoredWords: string[]; // 예외 처리할 단어들
}

// API 설정 파일에서 기본값 로드 (로컬 개발용)
function loadApiConfig(): PluginSettings {
  try {
    // Node.js 환경에서만 작동 (개발 시)
    if (typeof require !== 'undefined') {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(__dirname, 'api-config.json');
      
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('로컬 API 설정 파일을 로드했습니다.');
        return config;
      }
    }
  } catch (error) {
    console.log('API 설정 파일을 찾을 수 없습니다. 기본값을 사용합니다.');
  }
  
  // 기본값 (배포용)
  return {
    apiKey: '', // 사용자가 직접 입력해야 함
    apiHost: 'bareun-api.junlim.org',
    apiPort: 443,
    ignoredWords: []
  };
}

const DEFAULT_SETTINGS: PluginSettings = loadApiConfig();

// Bareun.ai API 응답 인터페이스
interface BareunResponse {
  origin: string;
  revised: string;
  revisedSentences?: Array<{
    origin: string;
    revised: string;
    revisedBlocks?: Array<{
      origin: {
        content: string;
        beginOffset: number;
        length: number;
      };
      revised: string;
      revisions: Array<{
        revised: string;
        category: string;
        comment: string;
        examples: string[];
        ruleArticle: string;
        score: number;
      }>;
    }>;
  }>;
}

addIcon(
  "han-spellchecker",
  `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 18 18" fill="currentColor"><path d="M3.6,3.9c1.3,0,2.9,0,4.2,0,.7,0,2.3-.5,2.3.7,0,.3-.3.5-.6.5-2.2,0-4.6.2-6.8,0-.4,0-.7-.4-.8-.8-.2-.7,1.2-.7,1.5-.4h0ZM6.1,11c-4.2,0-3.7-5.8.7-5.2,3.7.2,3.1,5.6-.5,5.2h-.2ZM3.6,1.6c.7,0,1.5.4,2.3.4.8.1,1.6,0,2.4,0,.8,1.2-1.4,1.5-2.9,1.3-.9,0-2.7-.8-1.9-1.7h0ZM6.3,9.7c2.5,0,1.9-3.4-.6-2.8-1.2.2-1.4,1.8-.5,2.4.2.2.9.2,1,.3h0ZM4.9,13.2c-.1-1.2,1.5-.9,1.6.1.4,1.5-.2,2.3,2,2.1,1,0,6.7-.6,5,1.1-2.3.5-5.4.7-7.6-.3-.6-.8-.3-2.2-.9-3h0ZM11.3,1.1c2.6-.3,1.5,3.8,2,5,.6.4,2.6-.5,2.8.7,0,.4-.3.6-.6.7-.7.1-1.6,0-2.3.1-.2.1,0,.5-.1,1.1,0,1,0,4.2-.8,4.2-.2,0-.5-.3-.6-.6-.3-1.4,0-3.4,0-5,0-1.9,0-3.8-.2-4.6-.1-.4-.5-1.2-.1-1.5h.1Z"/></svg>`
);

async function checkSpelling(
  text: string,
  settings: PluginSettings
): Promise<{ resultOutput: string; corrections: Correction[] }> {
  // API 키가 설정되지 않은 경우 에러 처리
  if (!settings.apiKey || settings.apiKey.trim() === '') {
    throw new Error("API 키가 설정되지 않았습니다. 플러그인 설정에서 Bareun.ai API 키를 입력해주세요.");
  }

  const protocol = settings.apiPort === 443 ? 'https' : 'http';
  const port = (settings.apiPort === 443 || settings.apiPort === 80) ? '' : `:${settings.apiPort}`;
  const apiUrl = `${protocol}://${settings.apiHost}${port}/bareun/api/v1/correct-error`;
  
  const requestBody = {
    document: {
      content: text,
      type: "PLAIN_TEXT"
    },
    encoding_type: "UTF8",
    auto_split: true
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": settings.apiKey
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
  }

  const data: BareunResponse = await response.json();
  return parseBareunResults(data, text);
}

function parseBareunResults(data: BareunResponse, originalText: string): {
  resultOutput: string;
  corrections: Correction[];
} {
  const corrections: Correction[] = [];
  let resultOutput = data.revised || originalText;

  // revisedSentences에서 상세 오류 정보 추출
  // 위치와 내용을 모두 고려한 중복 제거를 위한 맵
  const correctionMap = new Map<string, Correction>(); // 원문별로 교정 정보 통합
  const processedPositions = new Set<string>(); // 이미 처리된 위치 추적
  
  console.log('=== Bareun API 응답 분석 ===');
  console.log('원본 텍스트:', originalText);
  console.log('교정된 텍스트:', data.revised);
  console.log('revisedSentences 수:', data.revisedSentences?.length || 0);
  
  if (data.revisedSentences && Array.isArray(data.revisedSentences)) {
    data.revisedSentences.forEach((sentence, sentenceIndex) => {
      console.log(`\n--- 문장 ${sentenceIndex + 1} ---`);
      console.log('원본 문장:', sentence.origin);
      console.log('교정된 문장:', sentence.revised);
      console.log('revisedBlocks 수:', sentence.revisedBlocks?.length || 0);
      
      if (sentence.revisedBlocks && Array.isArray(sentence.revisedBlocks)) {
        sentence.revisedBlocks.forEach((block, blockIndex) => {
          console.log(`\n  블록 ${blockIndex + 1}:`);
          console.log('  원본 내용:', block.origin?.content);
          console.log('  원본 위치:', `${block.origin?.beginOffset}-${block.origin?.beginOffset + block.origin?.length}`);
          console.log('  교정:', block.revised);
          console.log('  제안 수:', block.revisions?.length || 0);
          
          if (block.origin && block.revised && block.revisions) {
            const blockOriginalText = block.origin.content;
            const position = block.origin.beginOffset;
            const length = block.origin.length;
            const positionKey = `${position}-${length}-${blockOriginalText}`;
            
            // 빈 텍스트나 깨진 문자는 제외
            if (!blockOriginalText || blockOriginalText.trim().length === 0) {
              console.log('  -> 빈 텍스트로 건너뜀');
              return;
            }
            
            // 실제 원문에서 찾을 수 있는지 확인
            if (originalText.indexOf(blockOriginalText) === -1) {
              console.log('  -> 원본 텍스트에서 찾을 수 없어 건너뜀');
              return;
            }
            
            // 여러 수정 제안이 있을 경우 모두 포함
            const suggestions = block.revisions.map(rev => rev.revised);
            console.log('  제안들:', suggestions);
            
            // 중복 제거 및 원문과 다른 제안만 포함
            const uniqueSuggestions = [...new Set(suggestions)]
              .filter(s => {
                const isValid = s !== blockOriginalText && 
                               s.trim() !== blockOriginalText.trim() &&
                               s.length > 0 &&
                               !s.includes('�'); // 깨진 문자 제외
                console.log(`    "${s}" 유효성:`, isValid);
                return isValid;
              });
            
            console.log('  유효한 제안들:', uniqueSuggestions);
            
            // 유효한 제안이 있는 경우만 처리
            if (uniqueSuggestions.length > 0) {
              // 이미 있는 교정이면 제안을 추가, 없으면 새로 생성
              if (correctionMap.has(blockOriginalText)) {
                console.log('  -> 기존 교정에 제안 추가');
                const existing = correctionMap.get(blockOriginalText)!;
                // 새로운 제안들을 기존 제안들과 합치고 중복 제거
                const combinedSuggestions = [...new Set([...existing.corrected, ...uniqueSuggestions])];
                correctionMap.set(blockOriginalText, {
                  ...existing,
                  corrected: combinedSuggestions
                });
                console.log('  -> 통합된 제안들:', combinedSuggestions);
              } else {
                console.log('  -> 새 교정 생성');
                correctionMap.set(blockOriginalText, {
                  original: blockOriginalText,
                  corrected: uniqueSuggestions,
                  help: block.revisions[0]?.comment || "맞춤법 교정"
                });
                console.log('  -> 새 교정 제안들:', uniqueSuggestions);
              }
            } else {
              console.log('  -> 유효한 제안이 없어 건너뜀');
            }
          }
        });
      }
    });
  }
  
  // Map에서 배열로 변환
  corrections.push(...correctionMap.values());
  
  console.log('\n=== 최종 교정 결과 ===');
  console.log('교정 맵 크기:', correctionMap.size);
  console.log('최종 교정 배열:', corrections);

  // 만약 교정된 텍스트는 있지만 세부 오류 정보가 없는 경우
  if (corrections.length === 0 && resultOutput !== originalText) {
    console.log('\n세부 정보가 없어 diff 로직 사용');
    // 간단한 diff 로직으로 변경된 부분 찾기
    const words = originalText.split(/(\s+)/);
    const revisedWords = resultOutput.split(/(\s+)/);
    
    for (let i = 0; i < Math.min(words.length, revisedWords.length); i++) {
      if (words[i] !== revisedWords[i] && words[i].trim() && revisedWords[i].trim()) {
        corrections.push({
          original: words[i],
          corrected: [revisedWords[i]],
          help: "자동 교정됨"
        });
      }
    }
  }
  
  return { resultOutput, corrections };
}


function replaceFirstOccurrenceWithPlaceholder(
  text: string,
  search: string,
  placeholder: string
): string {
  const index = text.indexOf(search);
  if (index === -1) return text;
  return text.slice(0, index) + placeholder + text.slice(index + search.length);
}

function decodeHtmlEntities(text: string): string {
  const element = document.createElement("div");
  element.innerHTML = text;
  return element.textContent || "";
}

// 구식 함수들 제거됨 - 새로운 UI에서는 더 이상 필요하지 않음

function createCorrectionPopup(
  corrections: Correction[],
  selectedText: string,
  start: EditorPosition,
  end: EditorPosition,
  editor: Editor
) {
  // Initially assume no pagination needed, will be recalculated after DOM is ready
  let isLongText = false;
  
  let currentPreviewPage = 0;
  let dynamicCharsPerPage = 800; // Default value, will be calculated dynamically
  
  // Function to calculate optimal chars per page based on preview area height
  function calculateDynamicCharsPerPage() {
    const previewElement = document.getElementById("resultPreview");
    const errorSummary = document.getElementById("errorSummary");
    
    if (previewElement && errorSummary) {
      const previewRect = previewElement.getBoundingClientRect();
      const isErrorExpanded = !errorSummary.classList.contains("collapsed");
      
      // Calculate available height
      const availableHeight = previewRect.height;
      
      // More accurate estimation
      const avgCharsPerLine = 75; // Conservative estimate for Korean text
      const lineHeight = 15 * 1.7; // 15px font size * 1.7 line height
      const linesPerPage = Math.floor(availableHeight / lineHeight);
      
      // Calculate chars per page with different ranges based on state
      let calculatedChars;
      if (isErrorExpanded) {
        // When error area is expanded, use smaller pages
        calculatedChars = Math.max(500, Math.min(1000, linesPerPage * avgCharsPerLine));
      } else {
        // When error area is collapsed, use larger pages
        calculatedChars = Math.max(800, Math.min(1800, linesPerPage * avgCharsPerLine));
      }
      
      // Enhanced debugging with Korean text and more detailed information
      console.log(`%c[동적 페이지네이션] 계산 결과:`, 'color: #4CAF50; font-weight: bold; font-size: 14px;');
      console.log(`%c📐 미리보기 영역:`, 'color: #2196F3; font-weight: bold;', `높이 ${Math.round(availableHeight)}px`);
      console.log(`%c📝 예상 줄 수:`, 'color: #FF9800; font-weight: bold;', `${linesPerPage}줄`);
      console.log(`%c📄 오류 영역:`, 'color: #9C27B0; font-weight: bold;', isErrorExpanded ? '펼쳐짐 (더 작은 페이지)' : '접힘 (더 큰 페이지)');
      console.log(`%c📊 이전 값:`, 'color: #607D8B;', `${dynamicCharsPerPage}자`);
      console.log(`%c✨ 새 값:`, 'color: #4CAF50; font-weight: bold;', `${calculatedChars}자`);
      
      const difference = calculatedChars - dynamicCharsPerPage;
      if (difference !== 0) {
        console.log(`%c🔄 변화량:`, 'color: #E91E63; font-weight: bold;', `${difference > 0 ? '+' : ''}${difference}자`);
        console.log(`%c📈 변화율:`, 'color: #795548;', `${Math.round((difference / dynamicCharsPerPage) * 100)}%`);
      }
      
      return calculatedChars;
    }
    
    return 800; // fallback
  }
  
  // Helper function to find smart page breaks (sentence boundaries)
  function findSmartPageBreaks() {
    // Update dynamic chars per page first
    dynamicCharsPerPage = calculateDynamicCharsPerPage();
    
    // Determine if we actually need pagination based on calculated page size
    const needsPagination = selectedText.length > dynamicCharsPerPage;
    
    console.log(`%c[페이지네이션 판단]`, 'color: #FF5722; font-weight: bold;');
    console.log(`텍스트 길이: ${selectedText.length}자`);
    console.log(`계산된 페이지 크기: ${dynamicCharsPerPage}자`);
    console.log(`페이지네이션 필요: ${needsPagination ? 'Yes' : 'No'}`);
    
    if (!needsPagination) {
      isLongText = false;
      return [selectedText.length];
    }
    
    isLongText = true;
    
    const breaks = [];
    let currentPos = 0;
    
    while (currentPos < selectedText.length) {
      let targetEnd = Math.min(currentPos + dynamicCharsPerPage, selectedText.length);
      
      // If we're at the end, just add it
      if (targetEnd >= selectedText.length) {
        breaks.push(selectedText.length);
        break;
      }
      
      // Look for sentence endings within a reasonable range
      const minCharsPerPage = Math.max(300, Math.floor(dynamicCharsPerPage * 0.3));
      const searchRange = Math.floor(dynamicCharsPerPage * 0.4); // 더 넓은 범위에서 검색
      const searchStart = Math.max(targetEnd - searchRange, currentPos + minCharsPerPage);
      const searchEnd = Math.min(targetEnd + searchRange, selectedText.length);
      
      let bestBreak = targetEnd;
      let bestScore = 0; // 최적 끊는 지점을 점수로 평가
      
      // Look for sentence endings (한국어 문장 끝: ., !, ?, 다, 요, 함, 음 등)
      for (let i = searchEnd - 1; i >= searchStart; i--) {
        const char = selectedText[i];
        const nextChar = selectedText[i + 1];
        const prevChar = selectedText[i - 1];
        
        let score = 0;
        
        // 강한 문장 끝 패턴 (높은 점수)
        if ((char === '.' || char === '!' || char === '?') && 
            (nextChar === ' ' || nextChar === '\n' || nextChar === undefined)) {
          score = 100;
        }
        
        // 단락 끝 (매우 높은 점수)
        if (char === '\n' && (nextChar === '\n' || nextChar === undefined)) {
          score = 120;
        }
        
        // 한국어 문장 끝 패턴들
        if (i > 1) {
          const twoChars = selectedText.slice(i - 1, i + 1);
          const threeChars = selectedText.slice(i - 2, i + 1);
          const fourChars = selectedText.slice(i - 3, i + 1);
          
          // 높은 점수 패턴들
          if (twoChars.match(/[다요함음]\./) || 
              threeChars.match(/[습니입]다\./) ||
              fourChars.match(/[가하였]다\./)) {
            score = 90;
          }
          
          // 중간 점수 패턴들
          if (threeChars.match(/[습니입]다/) ||
              threeChars.match(/[였했]다/) ||
              twoChars.match(/[해요한됨]/) ||
              twoChars.match(/[며서고]/) ||
              fourChars.match(/[가하였]다/)) {
            score = 70;
          }
          
          // 낮은 점수 패턴들 (약한 문장 끝)
          if (char === ',' || char === ';' || char === ':') {
            score = 30;
          }
        }
        
        // 한 줄 끝 (중간 점수)
        if (char === '\n' && nextChar !== '\n') {
          score = 50;
        }
        
        // 거리 기반 보정 (target에 가까울수록 보너스)
        const distanceFromTarget = Math.abs(i - targetEnd);
        const maxDistance = searchRange;
        const distanceBonus = Math.max(0, 20 - (distanceFromTarget / maxDistance) * 20);
        score += distanceBonus;
        
        // 최소 길이 확보를 위한 보정
        const currentLength = i - currentPos;
        if (currentLength < minCharsPerPage) {
          score *= 0.5; // 너무 짧으면 점수 감소
        }
        
        // 더 좋은 끊는 지점을 찾았다면 업데이트
        if (score > bestScore && 
            (nextChar === ' ' || nextChar === '\n' || nextChar === undefined || score >= 70)) {
          bestBreak = i + 1;
          bestScore = score;
        }
      }
      
      // 최적 지점을 찾지 못했으면 공백이나 문장 부호라도 찾아보기
      if (bestScore < 50) {
        for (let i = searchEnd - 1; i >= searchStart; i--) {
          const char = selectedText[i];
          const nextChar = selectedText[i + 1];
          
          // 공백이나 기본 구두점에서 끊기
          if ((char === ' ' || char === ',' || char === ';') && nextChar && nextChar !== ' ') {
            bestBreak = i + 1;
            break;
          }
        }
      }
      
      console.log(`페이지 ${breaks.length + 1} 끊는 지점: ${bestBreak} (점수: ${bestScore}, 길이: ${bestBreak - currentPos}자)`);
      
      
      breaks.push(bestBreak);
      currentPos = bestBreak;
    }
    
    return breaks;
  }

  // Calculate smart page breaks (initial calculation with default)
  let pageBreaks = findSmartPageBreaks();
  
  // Calculate total pages
  let totalPreviewPages = pageBreaks.length;
  
  console.log(`%c[초기 페이지 계산]`, 'color: #9C27B0; font-weight: bold;');
  console.log(`페이지 분할점: [${pageBreaks.join(', ')}]`);
  console.log(`총 페이지 수: ${totalPreviewPages}`);
  console.log(`isLongText: ${isLongText}`);

  const popupHtml = `
    <div id="correctionPopup">
        <div class="popup-overlay"></div>
        <div class="popup-content">
            <div class="header">
                <h2>맞춤법 검사</h2>
                <button id="closePopupButton" class="close-btn-header">×</button>
            </div>
            <div class="content">
                <div class="preview-section">
                    <div class="preview-header">
                        <div class="preview-label">
                            미리보기 
                            <span class="preview-hint">(오류 텍스트를 클릭하면 수정/취소됩니다)</span>
                        </div>
                        <div class="color-legend">
                            <div class="color-legend-item">
                                <div class="color-legend-dot error"></div>
                                <span>오류</span>
                            </div>
                            <div class="color-legend-item">
                                <div class="color-legend-dot corrected"></div>
                                <span>수정</span>
                            </div>
                            <div class="color-legend-item">
                                <div class="color-legend-dot original-selected"></div>
                                <span>원본선택</span>
                            </div>
                        </div>
                        <div id="paginationContainer" class="pagination-controls" style="display: none;">
                            <button id="prevPreviewPage" class="pagination-btn" disabled>이전</button>
                            <span id="previewPageInfo" class="page-info">1 / 1</span>
                            <button id="nextPreviewPage" class="pagination-btn" disabled>다음</button>
                            <span id="pageCharsInfo" class="page-chars-info">(페이지당 ~${dynamicCharsPerPage}자)</span>
                        </div>
                    </div>
                    <div id="resultPreview" class="preview-text"></div>
                    <div id="errorSummary" class="error-summary collapsed">
                        <div class="error-summary-toggle">
                            <div class="left-section">
                                <span class="error-summary-label">발견된 오류</span>
                                <span class="error-count-badge">${corrections.length}</span>
                            </div>
                            <span class="toggle-icon">▼</span>
                        </div>
                        <div id="errorSummaryContent" class="error-summary-content"></div>
                    </div>
                </div>
                
                <div class="info-box">
                    <a href="https://bareun.ai/">Bareun.ai</a>에서 제공하는 한국어 맞춤법 검사 서비스
                </div>
            </div>
            
            <div class="button-area">
                <button id="applyCorrectionsButton" class="apply-btn">적용</button>
                <button id="cancelButton" class="cancel-btn">취소</button>
            </div>
        </div>
    </div>`;

  const popup = document.createElement("div");
  popup.innerHTML = popupHtml;
  document.body.appendChild(popup);
  
  // Mobile fix: Aggressive keyboard hiding
  if (editor) {
    // Try multiple approaches to hide mobile keyboard
    
    // Method 1: Blur CodeMirror editor
    const editorElement = (editor as any).cm?.dom || (editor as any).getScrollElement?.();
    if (editorElement && typeof editorElement.blur === 'function') {
      editorElement.blur();
    }
    
    // Method 2: Blur CodeMirror input elements specifically
    try {
      const cmEditor = (editor as any).cm;
      if (cmEditor) {
        // CodeMirror 6 style
        if (cmEditor.contentDOM) {
          cmEditor.contentDOM.blur();
        }
        // Also try to blur the editor view
        if (cmEditor.dom) {
          cmEditor.dom.blur();
        }
      }
    } catch (e) {
      console.log('CodeMirror blur attempt failed:', e);
    }
    
    // Method 3: Blur any active input/textarea elements
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && (
      activeElement.tagName === 'INPUT' || 
      activeElement.tagName === 'TEXTAREA' || 
      activeElement.contentEditable === 'true'
    )) {
      activeElement.blur();
    }
    
    // Method 4: Create temporary element and focus it to steal focus
    const tempElement = document.createElement('button');
    tempElement.style.position = 'absolute';
    tempElement.style.left = '-9999px';
    tempElement.style.opacity = '0';
    tempElement.style.pointerEvents = 'none';
    document.body.appendChild(tempElement);
    tempElement.focus();
    setTimeout(() => {
      document.body.removeChild(tempElement);
    }, 100);
    
    // Method 5: Force viewport change to trigger keyboard hide
    if (window.scrollTo) {
      const currentScroll = window.scrollY;
      window.scrollTo(0, currentScroll + 1);
      setTimeout(() => {
        window.scrollTo(0, currentScroll);
      }, 50);
    }
  }
  
  // Lock body scroll to prevent background interaction
  document.body.classList.add('spell-popup-open');

  let selectedCorrections: Record<string, any> = {};
  
  // Initialize with original text for all corrections
  // Clear any existing blue state flags to ensure clean initial state
  corrections.forEach((correction, index) => {
    selectedCorrections[index] = correction.original;
    // Ensure no blue state flags exist initially
    delete selectedCorrections[`${index}_blue`];
  });


  // Initialize preview with proper dynamic calculation after DOM is ready
  // Wait for DOM to be fully rendered before calculating dynamic page size
  setTimeout(() => {
    console.log('%c[초기 로딩] DOM 렌더링 완료 후 동적 페이지네이션 재계산', 'color: #FF5722; font-weight: bold;');
    
    // Recalculate with actual DOM dimensions
    const previousCharsPerPage = dynamicCharsPerPage;
    pageBreaks = findSmartPageBreaks();
    totalPreviewPages = pageBreaks.length;
    
    // Update pagination controls based on actual need
    const paginationContainer = document.getElementById("paginationContainer");
    const prevPreviewBtn = document.getElementById("prevPreviewPage") as HTMLButtonElement;
    const nextPreviewBtn = document.getElementById("nextPreviewPage") as HTMLButtonElement;
    const previewPageInfo = document.getElementById("previewPageInfo");
    const pageCharsInfo = document.getElementById("pageCharsInfo");
    
    if (totalPreviewPages > 1 && isLongText) {
      // Show pagination controls
      if (paginationContainer) paginationContainer.style.display = 'flex';
      
      if (prevPreviewBtn) prevPreviewBtn.disabled = currentPreviewPage === 0;
      if (nextPreviewBtn) nextPreviewBtn.disabled = currentPreviewPage === totalPreviewPages - 1;
      if (previewPageInfo) previewPageInfo.textContent = `${currentPreviewPage + 1} / ${totalPreviewPages}`;
      if (pageCharsInfo) {
        pageCharsInfo.textContent = `(페이지당 ~${dynamicCharsPerPage}자)`;
        
        // Show initial calculation notification if there's a significant difference
        const difference = Math.abs(dynamicCharsPerPage - previousCharsPerPage);
        if (difference > 100) {
          console.log(`%c[초기 로딩] 페이지 크기 조정: ${previousCharsPerPage}자 → ${dynamicCharsPerPage}자`, 'color: #4CAF50; font-weight: bold;');
          
          // Add subtle highlight effect for initial load
          pageCharsInfo.style.background = '#2196F3';
          pageCharsInfo.style.color = 'white';
          pageCharsInfo.style.padding = '3px 8px';
          pageCharsInfo.style.borderRadius = '4px';
          pageCharsInfo.style.fontWeight = 'bold';
          
          setTimeout(() => {
            pageCharsInfo.style.background = '';
            pageCharsInfo.style.color = '';
            pageCharsInfo.style.padding = '';
            pageCharsInfo.style.fontWeight = '';
          }, 1500);
        }
      }
    } else {
      // Hide pagination controls
      if (paginationContainer) paginationContainer.style.display = 'none';
      console.log(`%c[초기 로딩] 페이지네이션 숨김 - 단일 페이지`, 'color: #795548; font-weight: bold;');
    }
    
    // Update preview with new calculations
    updatePreview();
  }, 100); // Small delay to ensure DOM is fully rendered
  
  // Initial preview update
  updatePreview();

  function closePopup() {
    const popupElement = document.getElementById("correctionPopup");
    if (popupElement) {
      popupElement.removeEventListener("click", handleClick);
      popupElement.remove();
    }
    document.removeEventListener("keydown", escKeyListener);
    
    // Unlock body scroll
    document.body.classList.remove('spell-popup-open');
    
    // Mobile fix: Restore editor focus if needed
    // Note: We don't automatically refocus to avoid unwanted keyboard popup
    // User can manually tap the editor if they want to continue editing
  }


  // Helper function to get current preview text based on smart pagination
  function getCurrentPreviewText() {
    if (!isLongText) return selectedText;
    
    const startIndex = currentPreviewPage === 0 ? 0 : pageBreaks[currentPreviewPage - 1];
    const endIndex = pageBreaks[currentPreviewPage];
    return selectedText.slice(startIndex, endIndex);
  }
  
  // Helper function to get current corrections based on preview page
  function getCurrentCorrections() {
    if (!isLongText) return corrections;
    
    // Get corrections that fall within current preview range using smart page breaks
    const previewStartIndex = currentPreviewPage === 0 ? 0 : pageBreaks[currentPreviewPage - 1];
    const previewEndIndex = pageBreaks[currentPreviewPage];
    
    // 더 정확한 위치 매칭을 위한 개선된 로직 (updatePreview와 동일)
    const currentCorrections: Correction[] = [];
    const usedPositions = new Set<number>();
    
    corrections.forEach((correction, index) => {
      // 각 correction에 대해 전체 텍스트에서 모든 위치를 찾기
      let searchStart = 0;
      const positions = [];
      
      while (true) {
        const foundPos = selectedText.indexOf(correction.original, searchStart);
        if (foundPos === -1) break;
        positions.push(foundPos);
        searchStart = foundPos + 1;
      }
      
      // 현재 미리보기 범위에 있는 위치들 중에서 아직 사용되지 않은 첫 번째 위치 선택
      for (const pos of positions) {
        if (pos >= previewStartIndex && pos < previewEndIndex && !usedPositions.has(pos)) {
          usedPositions.add(pos);
          currentCorrections.push(correction);
          break;
        }
      }
    });
    
    return currentCorrections;
  }

  function updatePreview() {
    let previewText = getCurrentPreviewText();
    const previewStartIndex = isLongText ? (currentPreviewPage === 0 ? 0 : pageBreaks[currentPreviewPage - 1]) : 0;
    const previewEndIndex = isLongText ? pageBreaks[currentPreviewPage] : selectedText.length;
    
    console.log("Update preview:", {
      isLongText,
      currentPreviewPage,
      previewStartIndex,
      previewEndIndex,
      previewTextLength: previewText.length,
      totalPreviewPages
    });
    
    // Create array of text segments to build proper HTML
    let segments: Array<{text: string, type: 'normal' | 'error' | 'corrected' | 'original-selected', suggestion?: string, correctionIndex?: number}> = [];
    let lastIndex = 0;
    
    // Find corrections that fall within the current preview range
    // 더 정확한 위치 매칭을 위한 개선된 로직
    const relevantCorrections: Array<Correction & {index: number, position: number, relativePosition: number}> = [];
    const usedPositions = new Set<number>();
    
    corrections.forEach((correction, index) => {
      // 각 correction에 대해 전체 텍스트에서 모든 위치를 찾기
      let searchStart = 0;
      const positions = [];
      
      while (true) {
        const foundPos = selectedText.indexOf(correction.original, searchStart);
        if (foundPos === -1) break;
        positions.push(foundPos);
        searchStart = foundPos + 1;
      }
      
      console.log(`"${correction.original}" 발견된 위치들:`, positions);
      
      // 현재 미리보기 범위에 있는 위치들 중에서 아직 사용되지 않은 첫 번째 위치 선택
      for (const pos of positions) {
        if (pos >= previewStartIndex && pos < previewEndIndex && !usedPositions.has(pos)) {
          usedPositions.add(pos);
          relevantCorrections.push({
            ...correction,
            index,
            position: pos,
            relativePosition: pos - previewStartIndex
          });
          console.log(`"${correction.original}" 사용된 위치: ${pos} (상대위치: ${pos - previewStartIndex})`);
          break;
        }
      }
    });
    
    // 상대 위치에 따라 정렬
    relevantCorrections.sort((a, b) => a.relativePosition - b.relativePosition);
    
    console.log("미리보기 범위 내 관련 corrections:", relevantCorrections.map(c => ({
      original: c.original,
      position: c.position,
      relativePosition: c.relativePosition
    })));
    
    relevantCorrections.forEach((correction) => {
      const selectedValue = selectedCorrections[correction.index];
      const isOriginal = selectedValue === correction.original;
      const isSuggestion = correction.corrected.includes(selectedValue);
      
      console.log(`Processing correction ${correction.index}:`, {
        original: correction.original,
        selectedValue,
        isOriginal,
        isSuggestion,
        suggestions: correction.corrected
      });
      
      // Add text before this correction (relative to preview text)
      if (correction.relativePosition > lastIndex) {
        segments.push({
          text: previewText.slice(lastIndex, correction.relativePosition),
          type: 'normal'
        });
      }
      
      // Add the correction segment with appropriate type based on selection
      // State machine: original (red) → suggestions (green) → original-selected (blue) → back to original (red)
      
      if (isOriginal) {
        // Check if this is the "original-selected" state (blue) or initial error state (red)
        const suggestions = correction.corrected;
        const allOptions = [...suggestions, correction.original];
        const currentIndex = allOptions.indexOf(selectedValue);
        const isLastInCycle = currentIndex === allOptions.length - 1;
        
        // Check if this is the blue state (original-selected)
        const isBlueState = selectedCorrections[`${correction.index}_blue`];
        
        if (isBlueState) {
          // This is the "original-selected" state - show as blue
          console.log(`Adding original-selected segment: text="${correction.original}", correctionIndex=${correction.index}`);
          segments.push({
            text: correction.original,
            type: 'original-selected',
            correctionIndex: correction.index
          });
        } else {
          // This is the initial error state - show as red
          const firstSuggestion = correction.corrected[0] || correction.original;
          segments.push({
            text: correction.original,
            type: 'error',
            suggestion: `추천: ${firstSuggestion}`,
            correctionIndex: correction.index
          });
        }
      } else if (isSuggestion) {
        // Suggestion selected - show as corrected (green)
        console.log(`Adding corrected segment: text="${selectedValue}", correctionIndex=${correction.index}`);
        segments.push({
          text: selectedValue,
          type: 'corrected',
          correctionIndex: correction.index
        });
      } else {
        // Fallback case - treat as corrected
        segments.push({
          text: selectedValue,
          type: 'corrected',
          correctionIndex: correction.index
        });
      }
      
      lastIndex = correction.relativePosition + correction.original.length;
    });
    
    // Add remaining text
    if (lastIndex < previewText.length) {
      segments.push({
        text: previewText.slice(lastIndex),
        type: 'normal'
      });
    }
    
    // Build HTML from segments
    const previewHtml = segments.map((segment, segmentIndex) => {
      const escapedText = segment.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      
      switch (segment.type) {
        case 'error':
          // Find the correction index for this error segment from relevant corrections
          const relevantCorrection = relevantCorrections.find(c => c.original === segment.text);
          const actualCorrectionIndex = relevantCorrection ? relevantCorrection.index : -1;
          const suggestionText = segment.suggestion?.replace('추천: ', '') || '';
          return `<span class="spell-error clickable-error" data-correction-index="${actualCorrectionIndex}" title="클릭하여 '${suggestionText}' 으로 수정" style="cursor: pointer;">${escapedText}</span>`;
        case 'corrected':
          const correctedIndex = segment.correctionIndex !== undefined ? segment.correctionIndex : -1;
          console.log(`HTML generation for corrected: segment.correctionIndex=${segment.correctionIndex}, correctedIndex=${correctedIndex}`);
          return `<span class="spell-corrected clickable-error" data-correction-index="${correctedIndex}" title="클릭하여 다음 제안으로 변경" style="cursor: pointer;">${escapedText}</span>`;
        case 'original-selected':
          const originalSelectedIndex = segment.correctionIndex !== undefined ? segment.correctionIndex : -1;
          console.log(`HTML generation for original-selected: segment.correctionIndex=${segment.correctionIndex}, originalSelectedIndex=${originalSelectedIndex}`);
          return `<span class="spell-original-selected clickable-error" data-correction-index="${originalSelectedIndex}" title="클릭하여 오류 상태로 되돌리기" style="cursor: pointer;">${escapedText}</span>`;
        default:
          return escapedText;
      }
    }).join('');
    
    const previewElement = document.getElementById("resultPreview");
    if (previewElement) {
      previewElement.innerHTML = previewHtml;
    }
    
    // Update error summary - show current page corrections with help text
    const errorSummaryContent = document.getElementById("errorSummaryContent");
    if (errorSummaryContent) {
      const currentCorrections = getCurrentCorrections();
      
      console.log("Current corrections for error summary:", currentCorrections.length);
      console.log("All corrections:", corrections.length);
      
      const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      
      // Update error count badge first
      const errorCountBadge = document.querySelector(".error-count-badge");
      if (errorCountBadge) {
        errorCountBadge.textContent = currentCorrections.length.toString();
      }
      
      // If no current corrections, show placeholder
      if (currentCorrections.length === 0) {
        const placeholderHtml = `
          <div class="error-placeholder">
            <div class="placeholder-icon">✓</div>
            <div class="placeholder-text">이 페이지에는 발견된 오류가 없습니다</div>
            <div class="placeholder-subtext">다른 페이지에서 오류를 확인하세요</div>
          </div>
        `;
        errorSummaryContent.innerHTML = placeholderHtml;
      } else {
        // Show current corrections
        const summaryHtml = currentCorrections.map((correction, relativeIndex) => {
          // Find the actual index in the original corrections array
          const actualIndex = corrections.findIndex(c => c.original === correction.original && c.help === correction.help);
          const selectedValue = selectedCorrections[actualIndex];
          const isChanged = selectedValue !== correction.original;
          const suggestions = correction.corrected.slice(0, 2); // 최대 2개만 표시 (공간 절약)
          
          console.log(`Error item ${relativeIndex}:`, {
            original: correction.original,
            actualIndex,
            selectedValue,
            suggestions
          });
          
          return `
            <div class="error-item-compact" data-correction-index="${actualIndex}">
              <div class="error-row">
                <div class="error-original-compact">${escapeHtml(correction.original)}</div>
                <div class="error-suggestions-compact">
                  ${suggestions.map(suggestion => 
                    `<span class="suggestion-compact ${selectedValue === suggestion ? 'selected' : ''}" 
                          data-value="${escapeHtml(suggestion)}" 
                          data-correction="${actualIndex}">
                      ${escapeHtml(suggestion)}
                    </span>`
                  ).join('')}
                  <span class="suggestion-compact ${selectedValue === correction.original ? 'selected' : ''} keep-original" 
                        data-value="${escapeHtml(correction.original)}" 
                        data-correction="${actualIndex}">
                    원본
                  </span>
                </div>
              </div>
              <div class="error-help-compact">${escapeHtml(correction.help)}</div>
            </div>
          `;
        }).join('');
        
        console.log("Generated summaryHtml:", summaryHtml);
        
        errorSummaryContent.innerHTML = summaryHtml;
      }
    }
    
    // Update pagination controls
    const paginationContainer = document.getElementById("paginationContainer");
    if (isLongText && totalPreviewPages > 1) {
      // Show and update pagination controls
      if (paginationContainer) paginationContainer.style.display = 'flex';
      
      const prevPreviewBtn = document.getElementById("prevPreviewPage") as HTMLButtonElement;
      const nextPreviewBtn = document.getElementById("nextPreviewPage") as HTMLButtonElement;
      const previewPageInfo = document.getElementById("previewPageInfo");
      
      if (prevPreviewBtn) prevPreviewBtn.disabled = currentPreviewPage === 0;
      if (nextPreviewBtn) nextPreviewBtn.disabled = currentPreviewPage === totalPreviewPages - 1;
      if (previewPageInfo) previewPageInfo.textContent = `${currentPreviewPage + 1} / ${totalPreviewPages}`;
    } else {
      // Hide pagination controls
      if (paginationContainer) paginationContainer.style.display = 'none';
    }
  }

  // Handle suggestion chip clicks, preview error clicks, and UI interactions
  function handleClick(e: Event) {
    const target = e.target as HTMLElement;
    
    // Mobile fix: Hide keyboard when clicking on preview area
    if (target.closest('#resultPreview') || target.id === 'resultPreview') {
      // Aggressive keyboard hiding for mobile
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement) {
        activeElement.blur();
      }
      
      // Create temporary element to steal focus
      const tempInput = document.createElement('input');
      tempInput.style.position = 'absolute';
      tempInput.style.left = '-9999px';
      tempInput.style.opacity = '0';
      tempInput.setAttribute('readonly', 'true');
      document.body.appendChild(tempInput);
      tempInput.focus();
      tempInput.blur();
      setTimeout(() => {
        document.body.removeChild(tempInput);
      }, 100);
      
      // Prevent default to avoid any focus behavior
      e.preventDefault();
    }
    
    // Handle background overlay clicks
    if (target.classList.contains("popup-overlay")) {
      closePopup();
      return;
    }
    
    // Handle preview pagination
    if (target.id === "prevPreviewPage" && currentPreviewPage > 0) {
      currentPreviewPage--;
      console.log("Preview page changed to:", currentPreviewPage);
      updatePreview();
      return;
    }
    
    if (target.id === "nextPreviewPage" && currentPreviewPage < totalPreviewPages - 1) {
      currentPreviewPage++;
      console.log("Preview page changed to:", currentPreviewPage);
      updatePreview();
      return;
    }
    

    // Handle error summary toggle
    if (target.classList.contains("error-summary-toggle") || target.closest(".error-summary-toggle")) {
      const errorSummary = document.getElementById("errorSummary");
      const toggleIcon = document.querySelector(".toggle-icon");
      if (errorSummary && toggleIcon) {
        errorSummary.classList.toggle("collapsed");
        toggleIcon.textContent = errorSummary.classList.contains("collapsed") ? "▼" : "▲";
        
        // Recalculate pagination after toggle (with a small delay for CSS transition)
        setTimeout(() => {
          const previousCharsPerPage = dynamicCharsPerPage;
          pageBreaks = findSmartPageBreaks();
          totalPreviewPages = pageBreaks.length;
          
          // Reset to first page if current page is out of bounds
          if (currentPreviewPage >= totalPreviewPages) {
            currentPreviewPage = 0;
          }
          
          // Update pagination controls based on actual need
          const paginationContainer = document.getElementById("paginationContainer");
          const prevPreviewBtn = document.getElementById("prevPreviewPage") as HTMLButtonElement;
          const nextPreviewBtn = document.getElementById("nextPreviewPage") as HTMLButtonElement;
          const previewPageInfo = document.getElementById("previewPageInfo");
          const pageCharsInfo = document.getElementById("pageCharsInfo");
          
          if (isLongText && totalPreviewPages > 1) {
            // Show pagination controls
            if (paginationContainer) paginationContainer.style.display = 'flex';
            
            if (prevPreviewBtn) prevPreviewBtn.disabled = currentPreviewPage === 0;
            if (nextPreviewBtn) nextPreviewBtn.disabled = currentPreviewPage === totalPreviewPages - 1;
            if (previewPageInfo) previewPageInfo.textContent = `${currentPreviewPage + 1} / ${totalPreviewPages}`;
            if (pageCharsInfo) {
              pageCharsInfo.textContent = `(페이지당 ~${dynamicCharsPerPage}자)`;
              
              // Show change notification if there's a significant difference
              const difference = Math.abs(dynamicCharsPerPage - previousCharsPerPage);
              if (difference > 100) {
                // Add visual flash effect to indicate change
                pageCharsInfo.style.background = '#4CAF50';
                pageCharsInfo.style.color = 'white';
                pageCharsInfo.style.padding = '3px 8px';
                pageCharsInfo.style.borderRadius = '4px';
                pageCharsInfo.style.transition = 'all 0.3s ease';
                pageCharsInfo.style.fontWeight = 'bold';
                
                // Show temporary notification
                const notification = document.createElement('div');
                notification.textContent = `페이지 크기가 ${previousCharsPerPage}자 → ${dynamicCharsPerPage}자로 변경되었습니다`;
                notification.style.cssText = `
                  position: fixed;
                  top: 50%;
                  left: 50%;
                  transform: translate(-50%, -50%);
                  background: #4CAF50;
                  color: white;
                  padding: 8px 16px;
                  border-radius: 4px;
                  font-size: 12px;
                  z-index: 1001;
                  opacity: 0;
                  transition: opacity 0.3s ease;
                `;
                document.body.appendChild(notification);
                
                // Show notification
                setTimeout(() => {
                  notification.style.opacity = '1';
                }, 10);
                
                // Hide notification after 2 seconds
                setTimeout(() => {
                  notification.style.opacity = '0';
                  setTimeout(() => {
                    if (notification.parentNode) {
                      notification.parentNode.removeChild(notification);
                    }
                  }, 300);
                }, 2000);
                
                // Reset pageCharsInfo style
                setTimeout(() => {
                  pageCharsInfo.style.background = '';
                  pageCharsInfo.style.color = '';
                  pageCharsInfo.style.padding = '';
                  pageCharsInfo.style.fontWeight = '';
                }, 1500);
              }
            }
          } else {
            // Hide pagination controls
            if (paginationContainer) paginationContainer.style.display = 'none';
          }
          
          updatePreview();
        }, 350); // Wait for CSS transition to complete
      }
      return;
    }
    
    // Handle preview error clicks - cycle through suggestions
    if (target.classList.contains("clickable-error")) {
      console.log("Preview error clicked:", target.dataset.correctionIndex);
      const correctionIndex = parseInt(target.dataset.correctionIndex || "-1");
      console.log("Parsed correction index:", correctionIndex);
      console.log("Target element:", target);
      console.log("Target text content:", target.textContent);
      
      if (correctionIndex >= 0 && correctionIndex < corrections.length && corrections[correctionIndex]) {
        const correction = corrections[correctionIndex];
        const suggestions = correction.corrected;
        const currentSelection = selectedCorrections[correctionIndex];
        
        console.log("Correction details:", {
          original: correction.original,
          suggestions,
          currentSelection,
          allSelectedCorrections: selectedCorrections
        });
        
        if (suggestions.length > 0) {
          // Create cycle: error (original) → suggestion1 → suggestion2 → ... → original-selected (blue) → error (original)
          // We need to track state differently since original appears in two states
          
          const isCurrentlyOriginal = currentSelection === correction.original;
          const currentSuggestionIndex = suggestions.indexOf(currentSelection);
          const isBlueState = selectedCorrections[`${correctionIndex}_blue`];
          
          console.log("Click state analysis:", {
            isCurrentlyOriginal,
            currentSuggestionIndex,
            isBlueState,
            currentSelection,
            suggestions,
            correctionIndex
          });
          
          if (isCurrentlyOriginal && !isBlueState) {
            // Initial red state → first suggestion (green)
            selectedCorrections[correctionIndex] = suggestions[0];
            // Ensure no blue flag exists
            delete selectedCorrections[`${correctionIndex}_blue`];
            console.log("Red → Green: Moving to first suggestion");
          } else if (isCurrentlyOriginal && isBlueState) {
            // Blue state → red state (remove blue flag)
            selectedCorrections[correctionIndex] = correction.original;
            delete selectedCorrections[`${correctionIndex}_blue`];
            console.log("Blue → Red: Removing blue flag");
          } else if (currentSuggestionIndex >= 0) {
            // Currently showing a suggestion (green)
            console.log(`Currently in suggestion state: index ${currentSuggestionIndex}, total suggestions: ${suggestions.length}`);
            if (currentSuggestionIndex < suggestions.length - 1) {
              // Move to next suggestion
              const nextSuggestion = suggestions[currentSuggestionIndex + 1];
              selectedCorrections[correctionIndex] = nextSuggestion;
              console.log(`Green → Green: Moving to suggestion ${currentSuggestionIndex + 1}: "${nextSuggestion}"`);
            } else {
              // Move to original-selected state (blue) by setting a special flag
              selectedCorrections[correctionIndex] = correction.original;
              selectedCorrections[`${correctionIndex}_blue`] = true;
              console.log("Green → Blue: Setting blue flag");
            }
          } else {
            // Unknown state, reset to first suggestion
            selectedCorrections[correctionIndex] = suggestions[0];
            console.log("Unknown → Green: Resetting to first suggestion");
          }
          
          console.log("Updated selectedCorrections:", selectedCorrections);
          updatePreview();
        }
      } else {
        console.log("Invalid correction index or correction not found:", correctionIndex);
      }
      return;
    }
    
    if (target.classList.contains("suggestion-option") || target.classList.contains("suggestion-compact")) {
      const correctionIndex = parseInt(target.dataset.correction || "0");
      const value = target.dataset.value || "";
      
      // Update selected correction
      selectedCorrections[correctionIndex] = value;
      
      // Update preview
      updatePreview();
    }
  }
  
  // Use event delegation on the popup container
  const popupElement = document.getElementById("correctionPopup");
  if (popupElement) {
    popupElement.addEventListener("click", handleClick);
  }


  document
    .getElementById("applyCorrectionsButton")
    ?.addEventListener("click", () => {
      let finalText = selectedText;
      
      // Apply corrections in reverse order
      for (let i = corrections.length - 1; i >= 0; i--) {
        const correction = corrections[i];
        const selectedValue = selectedCorrections[i];
        
        if (selectedValue !== correction.original) {
          finalText = finalText.replace(correction.original, selectedValue);
        }
      }

      editor.replaceRange(finalText, start, end);
      closePopup();
    });

  document
    .getElementById("closePopupButton")
    ?.addEventListener("click", closePopup);
    
  document
    .getElementById("cancelButton")
    ?.addEventListener("click", closePopup);

  function escKeyListener(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closePopup();
    }
  }

  document.addEventListener("keydown", escKeyListener);

  updatePreview();
}

class SpellingSettingTab extends PluginSettingTab {
  plugin: SpellingPlugin;

  constructor(app: App, plugin: SpellingPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '한국어 맞춤법 검사기 설정' });

    // API 키 설명 추가
    const apiKeyDescription = containerEl.createEl('div', { 
      text: 'Bareun.ai 계정이 필요합니다. https://bareun.ai/ 에서 회원가입 후 API 키를 발급받아 입력하세요.',
      cls: 'setting-item-description'
    });
    apiKeyDescription.style.marginBottom = '20px';
    apiKeyDescription.style.padding = '10px';
    apiKeyDescription.style.backgroundColor = 'var(--background-secondary)';
    apiKeyDescription.style.borderRadius = '5px';

    new Setting(containerEl)
      .setName('API 키 (필수)')
      .setDesc('Bareun.ai에서 발급받은 API 키를 입력하세요. 형식: koba-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX')
      .addText(text => text
        .setPlaceholder('koba-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('API 호스트')
      .setDesc('Bareun.ai API 서버 호스트 (클라우드: bareun-api.junlim.org, 로컬: localhost)')
      .addText(text => text
        .setPlaceholder('bareun-api.junlim.org')
        .setValue(this.plugin.settings.apiHost)
        .onChange(async (value) => {
          this.plugin.settings.apiHost = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('API 포트')
      .setDesc('Bareun.ai API 서버 포트 (클라우드: 443, 로컬: 5655)')
      .addText(text => text
        .setPlaceholder('443')
        .setValue(this.plugin.settings.apiPort.toString())
        .onChange(async (value) => {
          const port = parseInt(value);
          if (!isNaN(port)) {
            this.plugin.settings.apiPort = port;
            await this.plugin.saveSettings();
          }
        }));
  }
}

export default class SpellingPlugin extends Plugin {
  settings: PluginSettings;

  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("han-spellchecker", "Check Spelling", async () => {
      const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
      const editor = markdownView?.editor;
      if (!editor) {
        new Notice("에디터를 찾을 수 없습니다.");
        return;
      }

      let selectedText = editor.getSelection();
      let cursorStart = editor.getCursor("from");
      let cursorEnd = editor.getCursor("to");
      
      // If no text is selected, use entire document
      if (!selectedText || selectedText.trim().length === 0) {
        const fullText = editor.getValue();
        if (!fullText || fullText.trim().length === 0) {
          new Notice("문서에 텍스트가 없습니다.");
          return;
        }
        selectedText = fullText;
        // Set cursor positions to cover entire document
        try {
          // Method 1: Use official Obsidian Editor API
          const lastLine = editor.lastLine();
          const lastLineText = editor.getLine(lastLine);
          cursorStart = { line: 0, ch: 0 };
          cursorEnd = { line: lastLine, ch: lastLineText.length };
          editor.setSelection(cursorStart, cursorEnd);
          console.log("전체 문서 텍스트 선택됨 (Obsidian API):", selectedText.length, "자");
        } catch (e) {
          console.log("Obsidian API 사용 실패, 텍스트 기반 방법 사용:", e);
          // Fallback: Calculate positions from text content
          const lines = fullText.split('\n');
          cursorStart = { line: 0, ch: 0 };
          cursorEnd = { line: lines.length - 1, ch: lines[lines.length - 1].length };
          editor.setSelection(cursorStart, cursorEnd);
          console.log("전체 문서 텍스트 선택됨 (fallback method):", selectedText.length, "자");
        }
      }

      if (!cursorStart || !cursorEnd) {
        new Notice("텍스트의 시작 또는 끝 위치를 가져올 수 없습니다.");
        return;
      }

      editor.setCursor(cursorEnd);

      let resultOutput, corrections;
      try {
        ({ resultOutput, corrections } = await checkSpelling(selectedText, this.settings));
      } catch (error) {
        new Notice("맞춤법 검사를 수행할 수 없습니다.");
        console.error(error);
        return;
      }

      if (corrections.length === 0) {
        new Notice("수정할 것이 없습니다. 훌륭합니다!");
      } else {
        createCorrectionPopup(
          corrections,
          selectedText,
          cursorStart,
          cursorEnd,
          editor
        );
      }
    });

    this.addCommand({
      id: "check-spelling",
      name: "Check Spelling",
      editorCallback: async (editor) => {
        let selectedText = editor.getSelection();
        let cursorStart = editor.getCursor("from");
        let cursorEnd = editor.getCursor("to");
        
        // If no text is selected, use entire document
        if (!selectedText || selectedText.trim().length === 0) {
          const fullText = editor.getValue();
          if (!fullText || fullText.trim().length === 0) {
            new Notice("문서에 텍스트가 없습니다.");
            return;
          }
          selectedText = fullText;
          // Set cursor positions to cover entire document
          try {
            // Method 1: Use official Obsidian Editor API
            const lastLine = editor.lastLine();
            const lastLineText = editor.getLine(lastLine);
            cursorStart = { line: 0, ch: 0 };
            cursorEnd = { line: lastLine, ch: lastLineText.length };
            editor.setSelection(cursorStart, cursorEnd);
            console.log("전체 문서 텍스트 선택됨 (Obsidian API):", selectedText.length, "자");
          } catch (e) {
            console.log("Obsidian API 사용 실패, 텍스트 기반 방법 사용:", e);
            // Fallback: Calculate positions from text content
            const lines = fullText.split('\n');
            cursorStart = { line: 0, ch: 0 };
            cursorEnd = { line: lines.length - 1, ch: lines[lines.length - 1].length };
            editor.setSelection(cursorStart, cursorEnd);
            console.log("전체 문서 텍스트 선택됨 (fallback method):", selectedText.length, "자");
          }
        }

        if (!cursorStart || !cursorEnd) {
          new Notice("텍스트의 시작 또는 끝 위치를 가져올 수 없습니다.");
          return;
        }

        editor.setCursor(cursorEnd);

        let resultOutput, corrections;
        try {
          ({ resultOutput, corrections } = await checkSpelling(selectedText, this.settings));
        } catch (error) {
          new Notice("맞춤법 검사를 수행할 수 없습니다.");
          console.error(error);
          return;
        }

        if (corrections.length === 0) {
          new Notice("수정할 것이 없습니다. 훌륭합니다!");
        } else {
          createCorrectionPopup(
            corrections,
            selectedText,
            cursorStart,
            cursorEnd,
            editor
          );
        }
      },
    });

    // 설정 탭 추가
    this.addSettingTab(new SpellingSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
