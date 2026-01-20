"""
Explainability utilities for ASAG.
"""
import numpy as np
from typing import List, Dict, Tuple, Optional
from numpy.typing import NDArray


def compute_token_contributions(
    tokens: List[str],
    token_embeddings: NDArray[np.float32],
    rubric_embedding: NDArray[np.float32],
    method: str = "attention"
) -> List[Tuple[str, float]]:
    """Compute contribution scores for each token toward the rubric dimension."""
    if len(tokens) == 0 or len(token_embeddings) == 0:
        return []
    
    if method == "attention":
        contributions = []
        rubric_norm = np.linalg.norm(rubric_embedding)
        
        if rubric_norm == 0:
            return [(token, 0.0) for token in tokens]
        
        for i, (token, token_emb) in enumerate(zip(tokens, token_embeddings)):
            token_norm = np.linalg.norm(token_emb)
            if token_norm == 0:
                contributions.append((token, 0.0))
            else:
                sim = np.dot(token_emb, rubric_embedding) / (token_norm * rubric_norm)
                contributions.append((token, float(sim)))
        
        return contributions
    else:
        return [(token, 0.0) for token in tokens]


def extract_evidence_spans(
    text: str,
    token_contributions: List[Tuple[str, float]],
    top_k: int = 3,
    min_span_length: int = 2,
    max_span_length: int = 10
) -> List[Dict]:
    """Extract top contributing spans from the text."""
    if not token_contributions:
        return []
    
    tokens = [t for t, _ in token_contributions]
    scores = np.array([s for _, s in token_contributions])
    
    # Normalize scores
    if scores.max() > scores.min():
        norm_scores = (scores - scores.min()) / (scores.max() - scores.min())
    else:
        norm_scores = np.zeros_like(scores)
    
    # Find high-contribution regions
    threshold = np.median(norm_scores) + 0.1 if len(norm_scores) > 0 else 0.5
    high_contrib = norm_scores >= threshold
    
    # Extract contiguous spans
    spans = []
    i = 0
    while i < len(tokens):
        if high_contrib[i]:
            start = i
            end = i + 1
            
            # Extend span
            while end < len(tokens) and end - start < max_span_length:
                if high_contrib[end]:
                    end += 1
                else:
                    break
            
            if end - start >= min_span_length:
                span_tokens = tokens[start:end]
                span_score = float(np.mean(norm_scores[start:end]))
                span_text = " ".join(span_tokens)
                
                spans.append({
                    "text": span_text,
                    "score": span_score,
                    "char_start": None,
                    "char_end": None
                })
            
            i = end
        else:
            i += 1
    
    # Sort by score
    spans.sort(key=lambda x: x["score"], reverse=True)
    top_spans = spans[:top_k]
    
    # Try to locate spans in original text
    for span in top_spans:
        try:
            idx = text.lower().find(span["text"].lower())
            if idx >= 0:
                span["char_start"] = idx
                span["char_end"] = idx + len(span["text"])
        except:
            pass
    
    return top_spans


def generate_feedback(
    dimension_name: str,
    score: float,
    evidence_spans: List[Dict],
    rubric_text: str,
    confidence: float
) -> str:
    """Generate human-readable feedback for a rubric dimension."""
    # Determine performance level
    if score >= 0.8:
        level = "Excellent"
        verb = "fully addresses"
    elif score >= 0.6:
        level = "Good"
        verb = "mostly addresses"
    elif score >= 0.4:
        level = "Partial"
        verb = "partially addresses"
    else:
        level = "Needs Improvement"
        verb = "does not adequately address"
    
    # Build feedback
    feedback_parts = [f"**{dimension_name}** ({level}, {score:.0%}):"]
    feedback_parts.append(f"Your answer {verb} this criterion.")
    
    if evidence_spans:
        evidence_texts = [f'"{s["text"]}"' for s in evidence_spans[:2]]
        feedback_parts.append(f"Evidence: {', '.join(evidence_texts)}")
    
    if score < 0.8:
        feedback_parts.append(f"Consider addressing: {rubric_text[:100]}...")
    
    if confidence < 0.6:
        feedback_parts.append("(Low confidence - manual review recommended)")
    
    return " ".join(feedback_parts)


def highlight_text_html(
    text: str,
    evidence_spans: List[Dict],
    positive_color: str = "#90EE90",
    negative_color: str = "#FFB6C1"
) -> str:
    """Generate HTML with highlighted evidence spans."""
    if not evidence_spans:
        return text
    
    # Sort spans by position
    sorted_spans = sorted(
        [s for s in evidence_spans if s.get("char_start") is not None],
        key=lambda x: x["char_start"]
    )
    
    if not sorted_spans:
        return text
    
    result = []
    last_end = 0
    
    for span in sorted_spans:
        start = span["char_start"]
        end = span["char_end"]
        
        if start > last_end:
            result.append(text[last_end:start])
        
        color = positive_color if span["score"] >= 0.5 else negative_color
        result.append(f'<mark style="background-color: {color}">{text[start:end]}</mark>')
        last_end = end
    
    if last_end < len(text):
        result.append(text[last_end:])
    
    return "".join(result)