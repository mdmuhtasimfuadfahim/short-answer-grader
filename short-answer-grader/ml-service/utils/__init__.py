"""
Utility modules for the ML microservice.
"""
from .preprocessing import preprocess_text, normalize_score, split_into_rubric_dims
from .scorer import compute_cosine_similarity, aggregate_scores, scale_similarity
from .explainability import (
    compute_token_contributions,
    extract_evidence_spans,
    generate_feedback
)
from .contrastive import ContrastiveLoss, create_negative_samples

__all__ = [
    "preprocess_text",
    "normalize_score", 
    "split_into_rubric_dims",
    "compute_cosine_similarity",
    "aggregate_scores",
    "scale_similarity",
    "compute_token_contributions",
    "extract_evidence_spans",
    "generate_feedback",
    "ContrastiveLoss",
    "create_negative_samples"
]