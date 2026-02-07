"""Tests for final answer extraction in orchestrator."""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage

from pluto_duck_backend.agent.core.orchestrator import _extract_final_answer


def test_extract_final_answer_from_structured_ai_message_content() -> None:
    result = {
        "messages": [
            HumanMessage(content="헬로"),
            AIMessage(
                content=[
                    {"type": "reasoning", "summary": [], "index": 0},
                    {"type": "text", "text": "안녕하세요! 무엇을 도와드릴까요?", "index": 1},
                ]
            ),
        ]
    }

    answer = _extract_final_answer(result)

    assert answer == "안녕하세요! 무엇을 도와드릴까요?"


def test_extract_final_answer_from_structured_output_text_blocks() -> None:
    result = {
        "messages": [
            {
                "role": "assistant",
                "content": [
                    {"type": "reasoning", "summary": [{"type": "summary_text", "text": "thinking"}]},
                    {"type": "output_text", "text": "최종 답변"},
                ],
            }
        ]
    }

    answer = _extract_final_answer(result)

    assert answer == "최종 답변"


def test_extract_final_answer_falls_back_to_answer_field() -> None:
    result = {"finished": True, "answer": "fallback answer"}

    answer = _extract_final_answer(result)

    assert answer == "fallback answer"
