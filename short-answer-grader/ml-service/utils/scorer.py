"""
Scoring utilities for rubric-based grading.
"""
import numpy as np
from typing import List, Dict, Optional, Union
from numpy.typing import NDArray


def compute_cosine_similarity(
    vec_a: NDArray[np.float32],
    vec_b: NDArray[np.float32]
) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
    
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


def compute_batch_cosine_similarity(
    query_vec: NDArray[np.float32],
    reference_vecs: NDArray[np.float32]
) -> NDArray[np.float32]:
    """Compute cosine similarity between a query and multiple references."""
    query_norm = np.linalg.norm(query_vec)
    if query_norm == 0:
        return np.zeros(len(reference_vecs), dtype=np.float32)
    
    query_normalized = query_vec / query_norm
    
    ref_norms = np.linalg.norm(reference_vecs, axis=1, keepdims=True)
    ref_norms = np.where(ref_norms == 0, 1, ref_norms)
    refs_normalized = reference_vecs / ref_norms
    
    return np.dot(refs_normalized, query_normalized).astype(np.float32)


def scale_similarity(similarity: float) -> float:
    """Rescale cosine similarity from [-1, 1] to [0, 1]."""
    return (similarity + 1.0) / 2.0


def scale_similarities(similarities: Union[List[float], NDArray]) -> NDArray[np.float32]:
    """Rescale multiple similarities to [0, 1]."""
    arr = np.array(similarities, dtype=np.float32)
    return (arr + 1.0) / 2.0


def aggregate_scores(
    dimension_scores: List[float],
    weights: Optional[List[float]] = None
) -> float:
    """Aggregate per-dimension scores into an overall score."""
    if not dimension_scores:
        return 0.0
    
    scores = np.array(dimension_scores, dtype=np.float32)
    
    if weights is None:
        return float(np.mean(scores))
    
    weights = np.array(weights, dtype=np.float32)
    
    if len(weights) != len(scores):
        return float(np.mean(scores))
    
    # Normalize weights
    weight_sum = np.sum(weights)
    if weight_sum > 0:
        weights = weights / weight_sum
    else:
        weights = np.ones_like(weights) / len(weights)
    
    return float(np.sum(scores * weights))


def compute_confidence(
    similarity: float,
    margin_threshold: float = 0.3,
    distribution_stats: Optional[Dict[str, float]] = None
) -> float:
    """Compute confidence score for a prediction."""
    # Base confidence from absolute similarity
    abs_sim = abs(similarity)
    
    # Higher absolute similarity = higher confidence
    base_confidence = min(abs_sim / margin_threshold, 1.0) if margin_threshold > 0 else abs_sim
    
    # Scale to reasonable range (0.5 - 1.0 for high similarity)
    confidence = 0.5 + (base_confidence * 0.5)
    
    return min(1.0, max(0.0, confidence))


def compute_dimension_results(
    student_embedding: NDArray[np.float32],
    rubric_embeddings: Dict[str, NDArray[np.float32]],
    weights: Optional[Dict[str, float]] = None
) -> Dict:
    """Compute grading results for all dimensions."""
    dimension_scores = {}
    scores_list = []
    weights_list = []
    
    for dim_name, dim_embedding in rubric_embeddings.items():
        similarity = compute_cosine_similarity(student_embedding, dim_embedding)
        score = scale_similarity(similarity)
        confidence = compute_confidence(similarity)
        
        dimension_scores[dim_name] = {
            "score": score,
            "confidence": confidence,
            "similarity": similarity
        }
        
        scores_list.append(score)
        if weights:
            weights_list.append(weights.get(dim_name, 1.0))
    
    # Compute overall score
    overall = aggregate_scores(
        scores_list, 
        weights_list if weights else None
    )
    
    return {
        "overall_score": overall,
        "per_dimension": dimension_scores
    }