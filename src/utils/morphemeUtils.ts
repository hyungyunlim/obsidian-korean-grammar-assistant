import { Correction } from '../types/interfaces';
import { Logger } from './logger';

/**
 * 형태소 분석 관련 공통 유틸리티 함수들
 */
export class MorphemeUtils {
  
  /**
   * 교정 배열에서 중복된 오류를 제거하고 그룹화합니다.
   * 
   * @param corrections 원본 교정 배열
   * @param morphemeData 형태소 분석 결과 (선택사항)
   * @param originalText 원본 텍스트
   * @returns 중복 제거된 교정 배열
   */
  static removeDuplicateCorrections(
    corrections: Correction[], 
    morphemeData?: any, 
    originalText?: string
  ): Correction[] {
    if (corrections.length <= 1) {
      return corrections;
    }

    Logger.debug(`중복 제거 시작: ${corrections.length}개 교정`);

    // 형태소 데이터가 있으면 형태소 기반 그룹화 사용
    if (morphemeData && originalText) {
      return this.groupCorrectionsByMorphemes(corrections, morphemeData, originalText);
    }

    // 형태소 데이터가 없으면 기본 중복 제거 로직 사용
    return this.basicDuplicateRemoval(corrections);
  }

  /**
   * 형태소 정보를 기반으로 교정을 그룹화합니다.
   */
  private static groupCorrectionsByMorphemes(
    corrections: Correction[], 
    morphemeData: any, 
    originalText: string
  ): Correction[] {
    // 토큰 정보를 위치별로 매핑
    const tokenMap = new Map<string, any>();
    
    if (morphemeData.sentences) {
      morphemeData.sentences.forEach((sentence: any) => {
        sentence.tokens?.forEach((token: any) => {
          tokenMap.set(token.text.content, token);
        });
      });
    }

    Logger.debug('형태소 토큰 맵:', Array.from(tokenMap.keys()));

    // 겹치는 교정들을 식별하고 통합
    const groupedCorrections: Correction[] = [];
    const processedRanges = new Set<string>();

    corrections.forEach(correction => {
      const correctionPositions = this.findAllPositions(originalText, correction.original);
      
      correctionPositions.forEach(position => {
        const rangeKey = `${position}_${position + correction.original.length}`;
        
        if (!processedRanges.has(rangeKey)) {
          // 이 위치에서 겹치는 다른 교정들 찾기
          const overlappingCorrections = this.findOverlappingCorrections(
            corrections, originalText, position, correction.original.length
          );
          
          if (overlappingCorrections.length > 1) {
            Logger.debug(`위치 ${position}에서 겹치는 교정들:`, overlappingCorrections.map(c => c.original));
            
            // 형태소 정보를 기반으로 최적의 교정 선택
            const bestCorrection = this.selectBestCorrectionWithTokens(
              overlappingCorrections, tokenMap, originalText, position
            );
            
            if (bestCorrection) {
              groupedCorrections.push(bestCorrection);
            }
          } else {
            groupedCorrections.push(correction);
          }
          
          // 처리된 범위 표시
          overlappingCorrections.forEach(oc => {
            const ocPositions = this.findAllPositions(originalText, oc.original);
            ocPositions.forEach(pos => {
              const key = `${pos}_${pos + oc.original.length}`;
              processedRanges.add(key);
            });
          });
        }
      });
    });

    Logger.debug(`형태소 기반 교정 그룹화 완료: ${corrections.length}개 → ${groupedCorrections.length}개`);
    return groupedCorrections;
  }

  /**
   * 기본 중복 제거 로직 (형태소 데이터 없을 때)
   */
  private static basicDuplicateRemoval(corrections: Correction[]): Correction[] {
    const seen = new Set<string>();
    const unique: Correction[] = [];

    for (const correction of corrections) {
      const key = `${correction.original}:${JSON.stringify(correction.corrected)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(correction);
      }
    }

    Logger.debug(`기본 중복 제거 완료: ${corrections.length}개 → ${unique.length}개`);
    return unique;
  }

  /**
   * 텍스트에서 특정 문자열의 모든 위치를 찾습니다.
   */
  private static findAllPositions(text: string, searchText: string): number[] {
    const positions: number[] = [];
    let pos = text.indexOf(searchText);
    
    while (pos !== -1) {
      positions.push(pos);
      pos = text.indexOf(searchText, pos + 1);
    }
    
    return positions;
  }

  /**
   * 특정 위치에서 겹치는 교정들을 찾습니다.
   */
  private static findOverlappingCorrections(
    corrections: Correction[], 
    originalText: string, 
    position: number, 
    length: number
  ): Correction[] {
    const overlapping: Correction[] = [];
    
    corrections.forEach(correction => {
      const positions = this.findAllPositions(originalText, correction.original);
      
      positions.forEach(pos => {
        // 범위가 겹치는지 확인
        if (
          (pos >= position && pos < position + length) ||
          (pos + correction.original.length > position && pos + correction.original.length <= position + length) ||
          (pos <= position && pos + correction.original.length >= position + length)
        ) {
          if (!overlapping.find(oc => oc.original === correction.original)) {
            overlapping.push(correction);
          }
        }
      });
    });
    
    return overlapping;
  }

  /**
   * 형태소 토큰 정보를 기반으로 최적의 교정을 선택합니다.
   */
  private static selectBestCorrectionWithTokens(
    corrections: Correction[], 
    tokenMap: Map<string, any>, 
    originalText: string, 
    position: number
  ): Correction | null {
    if (corrections.length === 0) return null;
    if (corrections.length === 1) return corrections[0];

    // 토큰 정보가 있는 교정을 우선 선택
    for (const correction of corrections) {
      if (tokenMap.has(correction.original)) {
        const token = tokenMap.get(correction.original);
        Logger.debug(`토큰 기반 선택: "${correction.original}" (품사: ${token.morphemes?.[0]?.tag || 'unknown'})`);
        return correction;
      }
    }

    // 토큰 정보가 없으면 가장 긴 교정 선택
    const longest = corrections.reduce((prev, current) => 
      current.original.length > prev.original.length ? current : prev
    );
    
    Logger.debug(`길이 기반 선택: "${longest.original}"`);
    return longest;
  }

  /**
   * 형태소 분석 결과에서 고유명사/외국어를 감지합니다.
   */
  static isProperNounFromMorphemes(text: string, morphemeInfo: any): boolean {
    if (!morphemeInfo || !morphemeInfo.sentences) return false;

    for (const sentence of morphemeInfo.sentences) {
      for (const token of sentence.tokens || []) {
        if (token.text.content === text) {
          for (const morpheme of token.morphemes || []) {
            const tag = morpheme.tag;
            // 고유명사, 외국어, 한자어 등 태그 확인
            if (['NNP', 'SL', 'SH', 'SN'].includes(tag)) {
              Logger.debug(`형태소 고유명사 감지: "${text}" - 품사: ${tag}`);
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * 형태소 분석 결과에서 품사 정보를 추출합니다.
   */
  static extractPosInfo(text: string, morphemeInfo: any): {
    mainPos: string;
    tags: string[];
    confidence: number;
  } | undefined {
    if (!morphemeInfo || !morphemeInfo.sentences) return undefined;

    for (const sentence of morphemeInfo.sentences) {
      for (const token of sentence.tokens || []) {
        if (token.text.content === text) {
          const morphemes = token.morphemes || [];
          if (morphemes.length > 0) {
            const mainMorpheme = morphemes[0];
            return {
              mainPos: this.tagToKorean(mainMorpheme.tag),
              tags: morphemes.map((m: any) => m.tag),
              confidence: token.confidence || 1.0
            };
          }
        }
      }
    }

    return undefined;
  }

  /**
   * 형태소 태그를 한국어로 변환합니다.
   */
  private static tagToKorean(tag: string): string {
    const tagMap: Record<string, string> = {
      'NNG': '일반명사',
      'NNP': '고유명사',
      'NNB': '의존명사',
      'VV': '동사',
      'VA': '형용사',
      'VX': '보조용언',
      'MM': '관형사',
      'MAG': '일반부사',
      'SL': '외국어',
      'SH': '한자',
      'SN': '숫자'
    };
    
    return tagMap[tag] || tag;
  }
}