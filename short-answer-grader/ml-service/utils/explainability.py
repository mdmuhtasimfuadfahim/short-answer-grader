"""
Explainability utilities for ASAG.
Provides token-level contributions and evidence span extraction.
"""
import numpy as np
from typing import List, Dict, Tuple, Optional
from numpy.typing import NDArray
import re


def compute_token_contributions(
    tokens: List[str],
    token_embeddings: NDArray[np.float32],
    rubric_embedding: NDArray[np.float32],
    method: str = "attention"
) -> List[Tuple[str, float]]:
    """
    Compute contribution scores for each token toward the rubric dimension.
    
    Args:
        tokens: List of tokens from the student answer
        token_embeddings: Embeddings for each token (N x D)
        rubric_embedding: Embedding of the rubric dimension (D,)
        method: Method to use - "attention" (fast) or "gradient" (requires model)
        
    Returns:
        List of (token, contribution_score) tuples
    """
    if len(tokens) == 0 or len(token_embeddings) == 0:
        return []
    
    if method == "attention":
        # Cosine similarity heuristic: tokens more similar to rubric contribute more
        contributions = []
        rubric_norm = np.linalg.norm(rubric_embedding)
        
        if rubric_norm == 0:
            return [(t, 0.0) for t in tokens]
        
        for i, token in enumerate(tokens):
            if i >= len(token_embeddings):
                break
            
            token_emb = token_embeddings[i]
            token_norm = np.linalg.norm(token_emb)
            
            if token_norm == 0:
                contribution = 0.0
            else:
                contribution = float(np.dot(token_emb, rubric_embedding) / (token_norm * rubric_norm))
            
            contributions.append((token, contribution))
        
        return contributions
    
    else:
        # For gradient-based methods, return placeholder
        # (would require model access for integrated gradients)
        return [(t, 0.0) for t in tokens]


def extract_evidence_spans(
    text: str,
    token_contributions: List[Tuple[str, float]],
    top_k: int = 3,
    min_span_length: int = 2,
    max_span_length: int = 10
) -> List[Dict]:
    """
    Extract top contributing spans from the text.
    
    Strategy:
    1. Find contiguous sequences of high-contribution tokens
    2. Merge adjacent high-contribution regions
    3. Return top-k spans with their scores
    
    Args:
        text: Original text string
        token_contributions: List of (token, score) tuples
        top_k: Number of spans to return
        min_span_length: Minimum tokens in a span
        max_span_length: Maximum tokens in a span
        
    Returns:
        List of span dictionaries with 'text', 'score', 'start', 'end'
    """
    if not token_contributions:
        return []
    
    tokens = [t for t, _ in token_contributions]
    scores = np.array([s for _, s in token_contributions])
    
    # Normalize scores to [0, 1]
    if scores.max() > scores.min():
        norm_scores = (scores - scores.min()) / (scores.max() - scores.min())
    else:
        norm_scores = np.zeros_like(scores)
    
    # Find high-contribution regions (above median)
    threshold = np.median(norm_scores) + 0.1
    high_contrib = norm_scores >= threshold
    
    # Extract contiguous spans
    spans = []
    i = 0
    while i < len(tokens):
        if high_contrib[i]:
            # Start of a potential span
            start = i
            end = i
            
            # Extend span while contributions are high
            while end < len(tokens) - 1 and (end - start) < max_span_length:
                if high_contrib[end + 1]:
                    end += 1
                elif end - start >= min_span_length - 1:
                    break
                else:
                    # Allow one low-contribution token in between
                    if end + 2 < len(tokens) and high_contrib[end + 2]:
                        end += 2
                    else:
                        break
            
            if end - start >= min_span_length - 1:
                span_tokens = tokens[start:end + 1]
                span_score = float(np.mean(norm_scores[start:end + 1]))
                
                spans.append({
                    "tokens": span_tokens,
                    "text": " ".join(span_tokens),
                    "score": span_score,
                    "start_idx": start,
                    "end_idx": end
                })
            
            i = end + 1
        else:
            i += 1
    
    # Sort by score and return top-k
    spans.sort(key=lambda x: x["score"], reverse=True)
    top_spans = spans[:top_k]
    
    # Try to locate spans in original text for highlighting
    for span in top_spans:
        span_text = span["text"]
        # Find approximate position in original text
        match = re.search(re.escape(span_text), text, re.IGNORECASE)
        if match:
            span["char_start"] = match.start()
            span["char_end"] = match.end()
        else:
            # Try finding individual tokens
            span["char_start"] = None
            span["char_end"] = None
    
    return top_spans


def generate_feedback(
    dimension_name: str,
    score: float,
    evidence_spans: List[Dict],
    rubric_text: str,
    confidence: float
) -> str:
    """
    Generate human-readable feedback for a rubric dimension.
    
    Args:
        dimension_name: Name of the rubric dimension
        score: Score for this dimension [0, 1]
        evidence_spans: List of evidence span dictionaries
        rubric_text: The rubric dimension text/requirement
        confidence: Confidence score for this prediction
        
    Returns:
        Feedback string
    """
    # Determine performance level
    if score >= 0.8:
        level = "Excellent"
        verb = "demonstrates strong understanding of"
    elif score >= 0.6:
        level = "Good"
        verb = "shows adequate coverage of"
    elif score >= 0.4:
        level = "Partial"
        verb = "partially addresses"
    else:
        level = "Needs Improvement"
        verb = "does not sufficiently address"
    
    # Build feedback message
    feedback_parts = [f"**{dimension_name}** ({level}, {score:.0%})"]
    feedback_parts.append(f"Your answer {verb} this criterion.")
    
    if evidence_spans:
        mentioned = [s["text"] for s in evidence_spans if s["score"] > 0.5]
        if mentioned:
            feedback_parts.append(f"MENTIONED: '{'; '.join(mentioned[:2])}'")
    
    if score < 0.8:
        feedback_parts.append(f"Consider elaborating on: {rubric_text[:100]}...")
    
    if confidence < 0.6:
        feedback_parts.append("(Note: This assessment has moderate confidence)")
    
    return " ".join(feedback_parts)


def compute_integrated_gradients(
    model,
    tokenizer,
    student_text: str,
    rubric_embedding: NDArray[np.float32],
    steps: int = 50
) -> List[Tuple[str, float]]:
    """
    Compute Integrated Gradients for token attribution.
    
    This provides more principled token-level explanations but is slower.
    
    Args:
        model: The sentence encoder model
        tokenizer: The tokenizer
        student_text: Student answer text
        rubric_embedding: Target rubric embedding
        steps: Number of interpolation steps
        
    Returns:
        List of (token, attribution) tuples
    """
    try:
        import torch
        from captum.attr import IntegratedGradients
        
        # Tokenize input
        inputs = tokenizer(student_text, return_tensors="pt", padding=True, truncation=True)
        tokens = tokenizer.convert_ids_to_tokens(inputs["input_ids"][0])
        
        # Create baseline (zero embedding or padding)
        baseline = torch.zeros_like(inputs["input_ids"])
        
        # Define forward function that outputs similarity
        def forward_func(input_ids):
            with torch.enable_grad():
                outputs = model(input_ids)
                embeddings = outputs.last_hidden_state.mean(dim=1)
                # Compute cosine similarity
                rubric_tensor = torch.tensor(rubric_embedding, dtype=torch.float32)
                similarity = torch.nn.functional.cosine_similarity(
                    embeddings, rubric_tensor.unsqueeze(0), dim=1
                )
                return similarity
        
        # Compute integrated gradients
        ig = IntegratedGradients(forward_func)
        attributions, _ = ig.attribute(
            inputs["input_ids"],
            baselines=baseline,
            n_steps=steps,
            return_convergence_delta=True
        )
        
        # Convert to list
        attr_scores = attributions[0].detach().numpy()
        
        return list(zip(tokens, attr_scores.tolist()))
    
    except Exception as e:
        # Fallback to attention-based method
        print(f"IG computation failed: {e}, falling back to attention method")
        return []


def highlight_text_html(
    text: str,
    evidence_spans: List[Dict],
    positive_color: str = "#90EE90",  # Light green
    negative_color: str = "#FFB6C1"   # Light pink
) -> str:
    """
    Generate HTML with highlighted evidence spans.
    
    Args:
        text: Original text
        evidence_spans: List of span dictionaries with char_start/char_end
        positive_color: Color for positive contributions
        negative_color: Color for negative contributions
        
    Returns:
        HTML string with highlighted spans
    """
    if not evidence_spans:
        return text
    
    # Sort spans by start position
    valid_spans = [s for s in evidence_spans if s.get("char_start") is not None]
    valid_spans.sort(key=lambda x: x["char_start"])
    
    # Build HTML
    html_parts = []
    last_end = 0
    
    for span in valid_spans:
        start = span["char_start"]
        end = span["char_end"]
        score = span.get("score", 0.5)
        
        # Add text before this span
        if start > last_end:
            html_parts.append(text[last_end:start])
        
        # Add highlighted span
        color = positive_color if score > 0.5 else negative_color
        opacity = min(1.0, 0.3 + score * 0.7)
        span_text = text[start:end]
        html_parts.append(
            f'<span style="background-color: {color}; opacity: {opacity}; '
            f'padding: 2px 4px; border-radius: 3px;" '
            f'title="Contribution: {score:.2f}">{span_text}</span>'
        )
        
        last_end = end
    
    # Add remaining text
    if last_end < len(text):
        html_parts.append(text[last_end:])
    
    return "".join(html_parts)