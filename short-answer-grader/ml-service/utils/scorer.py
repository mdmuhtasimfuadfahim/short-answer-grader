"""
Scoring utilities for rubric-based grading.
Implements cosine similarity, score scaling, and aggregation.
"""
import numpy as np
from typing import List, Dict, Optional, Union
from numpy.typing import NDArray


def compute_cosine_similarity(
    vec_a: NDArray[np.float32],
    vec_b: NDArray[np.float32]
) -> float:
    """
    Compute cosine similarity between two vectors.
    
    Args:
        vec_a: First embedding vector
        vec_b: Second embedding vector
        
    Returns:
        Cosine similarity in range [-1, 1]
    """
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
    
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


def compute_batch_cosine_similarity(
    query_vec: NDArray[np.float32],
    reference_vecs: NDArray[np.float32]
) -> NDArray[np.float32]:
    """
    Compute cosine similarity between a query and multiple references.
    
    Args:
        query_vec: Query embedding (1D array)
        reference_vecs: Reference embeddings (2D array, each row is a reference)
        
    Returns:
        Array of cosine similarities
    """
    query_norm = np.linalg.norm(query_vec)
    if query_norm == 0:
        return np.zeros(len(reference_vecs), dtype=np.float32)
    
    query_normalized = query_vec / query_norm
    
    ref_norms = np.linalg.norm(reference_vecs, axis=1, keepdims=True)
    ref_norms = np.where(ref_norms == 0, 1, ref_norms)  # Avoid division by zero
    refs_normalized = reference_vecs / ref_norms
    
    return np.dot(refs_normalized, query_normalized).astype(np.float32)


def scale_similarity(similarity: float) -> float:
    """
    Rescale cosine similarity from [-1, 1] to [0, 1].
    
    Formula: score = (similarity + 1) / 2
    
    Args:
        similarity: Cosine similarity value
        
    Returns:
        Scaled score in [0, 1]
    """
    return (similarity + 1.0) / 2.0


def scale_similarities(similarities: Union[List[float], NDArray]) -> NDArray[np.float32]:
    """
    Rescale multiple similarities to [0, 1].
    
    Args:
        similarities: Array or list of similarity values
        
    Returns:
        Scaled scores array
    """
    arr = np.array(similarities, dtype=np.float32)
    return (arr + 1.0) / 2.0


def aggregate_scores(
    dimension_scores: List[float],
    weights: Optional[List[float]] = None
) -> float:
    """
    Aggregate per-dimension scores into an overall score.
    
    Args:
        dimension_scores: List of scores for each rubric dimension
        weights: Optional weights for each dimension (normalized internally)
        
    Returns:
        Aggregated overall score
    """
    if not dimension_scores:
        return 0.0
    
    scores = np.array(dimension_scores, dtype=np.float32)
    
    if weights is None:
        # Equal weighting
        return float(np.mean(scores))
    
    weights = np.array(weights, dtype=np.float32)
    
    # Ensure weights match scores length
    if len(weights) != len(scores):
        raise ValueError(f"Weights length ({len(weights)}) must match scores length ({len(scores)})")
    
    # Normalize weights to sum to 1
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
    """
    Compute confidence score for a prediction.
    
    Confidence is based on:
    1. Absolute similarity magnitude (higher = more confident)
    2. Distance from decision boundary (similarity near 0 = less confident)
    3. Optional: comparison to historical distribution
    
    Args:
        similarity: The cosine similarity value
        margin_threshold: Threshold for high-confidence predictions
        distribution_stats: Optional dict with 'mean' and 'std' of historical similarities
        
    Returns:
        Confidence score in [0, 1]
    """
    # Base confidence from absolute similarity
    abs_sim = abs(similarity)
    
    # Adjust for margin from zero (decision boundary)
    margin_confidence = min(1.0, abs_sim / margin_threshold)
    
    if distribution_stats is not None:
        # Z-score based confidence
        mean = distribution_stats.get('mean', 0.5)
        std = distribution_stats.get('std', 0.2)
        if std > 0:
            z_score = abs(similarity - mean) / std
            # High z-score near mean = lower confidence (ambiguous region)
            z_confidence = 1.0 - np.exp(-z_score)
        else:
            z_confidence = margin_confidence
        
        # Combine confidences
        return float((margin_confidence + z_confidence) / 2.0)
    
    return float(margin_confidence)


def compute_dimension_results(
    student_embedding: NDArray[np.float32],
    rubric_embeddings: Dict[str, NDArray[np.float32]],
    weights: Optional[Dict[str, float]] = None
) -> Dict:
    """
    Compute full grading results for all rubric dimensions.
    
    Args:
        student_embedding: Embedding of student answer
        rubric_embeddings: Dict mapping dimension name to embedding
        weights: Optional dict mapping dimension name to weight
        
    Returns:
        Dictionary with per-dimension scores and overall score
    """
    dimension_scores = {}
    scores_list = []
    weights_list = []
    
    for dim_name, dim_embedding in rubric_embeddings.items():
        similarity = compute_cosine_similarity(student_embedding, dim_embedding)
        scaled_score = scale_similarity(similarity)
        confidence = compute_confidence(similarity)
        
        dimension_scores[dim_name] = {
            "raw_similarity": similarity,
            "score": scaled_score,
            "confidence": confidence
        }
        scores_list.append(scaled_score)
        
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