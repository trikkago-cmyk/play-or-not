#!/usr/bin/env python3
"""
Run a configured RAG eval suite and enforce metric gates.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from rag_evals.run_eval import build_retriever, load_cases, score_case, summarize


SUPPORTED_SUMMARY_METRICS = {
    "hit_at_k",
    "strict_hit_at_k",
    "recall_at_k_mean",
    "precision_at_k_mean",
    "mrr_at_k_mean",
    "ndcg_at_k_mean",
    "distinct_game_ids_at_k_mean",
    "top_1_section_pass_rate",
    "forbidden_game_hit_rate",
    "pass_rate",
}


def resolve_path(raw_path: str, base_dir: Path) -> Path:
    path = Path(str(raw_path))
    if path.is_absolute():
        return path
    if path.exists():
        return path.resolve()
    return (base_dir / path).resolve()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run multi-dataset RAG eval suites with guardrails")
    parser.add_argument("--suite-config", required=True, help="JSON config describing which eval suites to run")
    parser.add_argument("--adapter-config", help="Retriever adapter config JSON; overrides suite-config adapter_config")
    parser.add_argument("--group", action="append", help="Only run suites matching these groups/tags")
    parser.add_argument("--report-json", help="Write combined suite report JSON to this path")
    parser.add_argument("--fail-on-threshold", action="store_true", help="Exit non-zero when any suite breaches min_metrics")
    return parser.parse_args()


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Expected object JSON in {path}")
    return data


def should_run_suite(entry: Dict[str, Any], requested_groups: Optional[List[str]]) -> bool:
    if not requested_groups:
        return True
    groups = entry.get("groups", [])
    if isinstance(groups, str):
        groups = [groups]
    if not isinstance(groups, list):
        return False
    normalized_groups = {str(group).strip() for group in groups if str(group).strip()}
    return any(group in normalized_groups for group in requested_groups)


def build_case_payloads(scored_cases: List[Any]) -> List[Dict[str, Any]]:
    payloads: List[Dict[str, Any]] = []
    for case in scored_cases:
        payloads.append(
            {
                "id": case.case_id,
                "category": case.category,
                "recall_at_k": case.recall_at_k,
                "precision_at_k": case.precision_at_k,
                "mrr_at_k": case.mrr_at_k,
                "ndcg_at_k": case.ndcg_at_k,
                "hit_at_k": case.hit_at_k,
                "strict_hit_at_k": case.strict_hit_at_k,
                "passed": case.passed,
                "matched_targets": case.matched_targets,
                "total_targets": case.total_targets,
                "game_matches": case.game_matches,
                "any_game_matches": case.any_game_matches,
                "forbidden_game_matches": case.forbidden_game_matches,
                "matched_keyword_groups": case.matched_keyword_groups,
                "distinct_game_ids_at_k": case.distinct_game_ids_at_k,
                "top_1_section_passed": case.top_1_section_passed,
                "top_chunks_preview": case.top_chunks_preview,
            }
        )
    return payloads


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def validate_metric_guards(min_metrics: Dict[str, Any]) -> Dict[str, float]:
    validated: Dict[str, float] = {}
    for metric_name, raw_threshold in min_metrics.items():
        if metric_name not in SUPPORTED_SUMMARY_METRICS:
            raise ValueError(
                f"Unsupported guarded metric `{metric_name}`. "
                f"Supported metrics: {sorted(SUPPORTED_SUMMARY_METRICS)}"
            )
        validated[metric_name] = float(raw_threshold)
    return validated


def main() -> int:
    args = parse_args()
    suite_config_path = Path(args.suite_config).resolve()
    suite_config_dir = suite_config_path.parent
    suite_config = load_json(suite_config_path)

    adapter_config_value = args.adapter_config or suite_config.get("adapter_config")
    if not adapter_config_value:
        raise ValueError("Suite config must define `adapter_config` or pass --adapter-config")
    adapter_config_path = resolve_path(str(adapter_config_value), suite_config_dir)
    adapter_config = load_json(adapter_config_path)

    report_dir = resolve_path(str(suite_config.get("report_dir", "rag_evals/reports")), suite_config_dir)
    requested_groups = [group.strip() for group in (args.group or []) if group and group.strip()]

    suites_raw = suite_config.get("suites")
    if not isinstance(suites_raw, list) or not suites_raw:
        raise ValueError("Suite config must contain a non-empty `suites` array")

    selected_suites = [entry for entry in suites_raw if isinstance(entry, dict) and should_run_suite(entry, requested_groups)]
    if not selected_suites:
        raise ValueError("No suites matched the requested filters")

    retriever = build_retriever(adapter_config)
    suite_results: List[Dict[str, Any]] = []
    threshold_failures: List[str] = []
    started_at = time.time()

    print("\n=== RAG Eval Suite ===")
    print(f"suite_config: {suite_config_path}")
    print(f"adapter_config: {adapter_config_path}")
    if requested_groups:
        print(f"groups: {', '.join(requested_groups)}")

    for entry in selected_suites:
        suite_name = str(entry.get("name") or "").strip()
        if not suite_name:
            raise ValueError("Each suite entry must define `name`")

        dataset_path = resolve_path(str(entry.get("dataset") or ""), suite_config_dir)
        if not str(dataset_path):
            raise ValueError(f"Suite `{suite_name}` is missing `dataset`")

        top_k = int(entry.get("top_k", 5))
        default_threshold = float(entry.get("default_threshold", 0.8))
        min_metrics = validate_metric_guards(entry.get("min_metrics", {}))

        cases = load_cases(dataset_path)
        scored_cases = []
        for case in cases:
            chunks = retriever.retrieve(case, top_k)
            scored_cases.append(score_case(case, chunks, top_k, default_threshold))

        summary = summarize(scored_cases)
        suite_report = {
            "name": suite_name,
            "dataset": str(dataset_path),
            "top_k": top_k,
            "default_threshold": default_threshold,
            "groups": entry.get("groups", []),
            "summary": summary,
            "cases": build_case_payloads(scored_cases),
        }
        suite_results.append(suite_report)

        output_report_path = (
            resolve_path(str(entry["report_json"]), suite_config_dir)
            if entry.get("report_json")
            else report_dir / f"{suite_name}.json"
        )
        ensure_parent(output_report_path)
        with output_report_path.open("w", encoding="utf-8") as handle:
            json.dump(suite_report, handle, ensure_ascii=False, indent=2)

        print(
            f"\n[{suite_name}] cases={summary['count']} "
            f"pass_rate={summary['pass_rate']:.3f} "
            f"strict_hit@{top_k}={summary['strict_hit_at_k']:.3f} "
            f"recall@{top_k}={summary['recall_at_k_mean']:.3f}"
        )
        print(f"report: {output_report_path}")

        for metric_name, threshold in min_metrics.items():
            actual_value = float(summary[metric_name])
            if actual_value + 1e-9 < threshold:
                threshold_failures.append(
                    f"{suite_name}: {metric_name}={actual_value:.3f} < required {threshold:.3f}"
                )

    combined_report = {
        "suite_config": str(suite_config_path),
        "adapter_config": str(adapter_config_path),
        "generated_at_epoch_sec": started_at,
        "duration_sec": round(time.time() - started_at, 3),
        "selected_groups": requested_groups,
        "suite_count": len(suite_results),
        "suites": suite_results,
        "threshold_failures": threshold_failures,
    }

    report_json_path = Path(args.report_json).resolve() if args.report_json else report_dir / "suite_latest.json"
    ensure_parent(report_json_path)
    with report_json_path.open("w", encoding="utf-8") as handle:
        json.dump(combined_report, handle, ensure_ascii=False, indent=2)

    print(f"\ncombined_report: {report_json_path}")

    if threshold_failures:
        print("\n=== Threshold Failures ===")
        for failure in threshold_failures:
            print(f"- {failure}")
        if args.fail_on_threshold:
            return 1

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
