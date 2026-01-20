"""
Text preprocessing utilities for ASAG.
Minimal cleaning to preserve domain-specific tokens.
"""
import re
import unicodedata
from typing import List, Tuple, Optional


def preprocess_text(
    text: str,
    lowercase: bool = False,
    normalize_unicode: bool = True,
    collapse_whitespace: bool = True
) -> str:
    """
    Apply minimal text preprocessing.
    
    Args:
        text: Input text string
        lowercase: Whether to convert to lowercase (default False to preserve acronyms)
        normalize_unicode: Whether to apply unicode normalization
        collapse_whitespace: Whether to collapse multiple spaces
        
    Returns:
        Preprocessed text string
    """
    if not text:
        return ""
    
    # Unicode normalization (NFKC form)
    if normalize_unicode:
        text = unicodedata.normalize("NFKC", text)
    
    # Optional lowercasing
    if lowercase:
        text = text.lower()
    
    # Collapse whitespace (preserve single spaces)
    if collapse_whitespace:
        text = re.sub(r'\s+', ' ', text).strip()
    
    return text


def normalize_score(score: float, min_score: float = 0.0, max_score: float = 1.0) -> float:
    """
    Normalize a score to [0, 1] range.
    
    Args:
        score: Raw score value
        min_score: Minimum possible score
        max_score: Maximum possible score
        
    Returns:
        Normalized score in [0, 1]
    """
    if max_score == min_score:
        return 0.5
    
    normalized = (score - min_score) / (max_score - min_score)
    return max(0.0, min(1.0, normalized))


def split_into_rubric_dims(
    reference_answer: str,
    num_dims: Optional[int] = None,
    delimiters: Tuple[str, ...] = (';', '.', ',')
) -> List[str]:
    """
    Heuristically split a reference answer into rubric dimensions.
    
    Strategy:
    1. First try splitting on semicolons (explicit list separator)
    2. Then split on sentences (period followed by space/capital)
    3. If still too few, split on commas for enumerated items
    
    Args:
        reference_answer: The reference/model answer text
        num_dims: Target number of dimensions (optional)
        delimiters: Tuple of delimiters to try in order
        
    Returns:
        List of rubric dimension phrases
    """
    if not reference_answer:
        return []
    
    text = preprocess_text(reference_answer)
    
    # Try semicolon split first (explicit enumeration)
    dims = [d.strip() for d in text.split(';') if d.strip()]
    
    # If only one part, try sentence splitting
    if len(dims) <= 1:
        # Split on period followed by space and capital letter or end
        sentence_pattern = r'(?<=[.!?])\s+(?=[A-Z])'
        dims = [d.strip() for d in re.split(sentence_pattern, text) if d.strip()]
    
    # If target specified and we have too few, try comma split on longer segments
    if num_dims and len(dims) < num_dims:
        expanded = []
        for dim in dims:
            # Only split on comma if the segment is long enough
            if len(dim) > 50 and ',' in dim:
                parts = [p.strip() for p in dim.split(',') if len(p.strip()) > 10]
                if len(parts) > 1:
                    expanded.extend(parts)
                else:
                    expanded.append(dim)
            else:
                expanded.append(dim)
        dims = expanded
    
    # Clean up: remove very short fragments
    dims = [d for d in dims if len(d) > 5]
    
    # If we have target and too many, merge smallest adjacent pairs
    if num_dims and len(dims) > num_dims:
        while len(dims) > num_dims:
            # Find shortest dimension and merge with neighbor
            min_idx = min(range(len(dims)), key=lambda i: len(dims[i]))
            if min_idx > 0:
                dims[min_idx - 1] = dims[min_idx - 1] + "; " + dims[min_idx]
                dims.pop(min_idx)
            elif min_idx < len(dims) - 1:
                dims[min_idx] = dims[min_idx] + "; " + dims[min_idx + 1]
                dims.pop(min_idx + 1)
            else:
                break
    
    return dims if dims else [text]


def create_rubric_record(
    question_id: str,
    reference_answer: str,
    rubric_dims: Optional[List[str]] = None,
    student_answer: str = "",
    true_score: Optional[float] = None
) -> dict:
    """
    Create a standardized training record.
    
    Args:
        question_id: Unique identifier for the question
        reference_answer: Model/reference answer
        rubric_dims: List of rubric dimension phrases (auto-generated if None)
        student_answer: Student's response
        true_score: Ground truth score (normalized to [0,1])
        
    Returns:
        Dictionary with standardized fields
    """
    if rubric_dims is None:
        rubric_dims = split_into_rubric_dims(reference_answer)
    
    return {
        "question_id": question_id,
        "reference_answer": preprocess_text(reference_answer),
        "rubric_dims": [preprocess_text(d) for d in rubric_dims],
        "student_answer": preprocess_text(student_answer),
        "true_score": true_score
    }


def batch_preprocess(texts: List[str], **kwargs) -> List[str]:
    """
    Preprocess a batch of texts.
    
    Args:
        texts: List of input texts
        **kwargs: Arguments passed to preprocess_text
        
    Returns:
        List of preprocessed texts
    """
    return [preprocess_text(t, **kwargs) for t in texts]