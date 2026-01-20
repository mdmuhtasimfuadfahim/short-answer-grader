"""
Text preprocessing utilities for ASAG.
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
    """Apply minimal text preprocessing."""
    if not text:
        return ""
    
    # Unicode normalization
    if normalize_unicode:
        text = unicodedata.normalize('NFKC', text)
    
    # Optional lowercasing
    if lowercase:
        text = text.lower()
    
    # Collapse whitespace
    if collapse_whitespace:
        text = re.sub(r'\s+', ' ', text).strip()
    
    return text


def normalize_score(score: float, min_score: float = 0.0, max_score: float = 1.0) -> float:
    """Normalize a score to [0, 1] range."""
    if max_score == min_score:
        return 0.5
    
    normalized = (score - min_score) / (max_score - min_score)
    return max(0.0, min(1.0, normalized))


def split_into_rubric_dims(
    reference_answer: str,
    num_dims: Optional[int] = None,
    delimiters: Tuple[str, ...] = (';', '.', ',')
) -> List[str]:
    """Heuristically split a reference answer into rubric dimensions."""
    if not reference_answer:
        return []
    
    text = preprocess_text(reference_answer)
    
    # Try semicolon split first
    dims = [d.strip() for d in text.split(';') if d.strip()]
    
    # If only one part, try sentence splitting
    if len(dims) <= 1:
        # Split on period followed by space or end
        sentences = re.split(r'\.(?:\s|$)', text)
        dims = [s.strip() for s in sentences if s.strip() and len(s.strip()) > 10]
    
    # If still too few and target specified, try comma split
    if num_dims and len(dims) < num_dims:
        new_dims = []
        for dim in dims:
            if ',' in dim and len(dim) > 50:
                parts = [p.strip() for p in dim.split(',') if len(p.strip()) > 10]
                new_dims.extend(parts)
            else:
                new_dims.append(dim)
        dims = new_dims
    
    # Clean up: remove very short fragments
    dims = [d for d in dims if len(d) > 5]
    
    # Limit to reasonable number
    if len(dims) > 10:
        dims = dims[:10]
    
    # If we have target and too many, keep only the longest ones
    if num_dims and len(dims) > num_dims:
        dims = sorted(dims, key=len, reverse=True)[:num_dims]
    
    return dims if dims else [text]


def create_rubric_record(
    question_id: str,
    reference_answer: str,
    rubric_dims: Optional[List[str]] = None,
    student_answer: str = "",
    true_score: Optional[float] = None
) -> dict:
    """Create a standardized training record."""
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
    """Preprocess a batch of texts."""
    return [preprocess_text(t, **kwargs) for t in texts]