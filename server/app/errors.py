"""오류 하나에 모양 하나.

계약(`API.md` 의 '에러')은 `{ code, message, detail? }` 다. 프론트가 `code` 로 갈라 보기 때문에
FastAPI 기본 `{"detail": ...}` 로 새면 화면이 오류를 구분하지 못한다 — 핸들러 넷이 전부 받아
같은 모양으로 바꾼다. **422 검증 오류도 같은 모양이다.**
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """화면이 그대로 띄울 수 있는 오류. `message` 는 한국어 한 줄이다."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        detail: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detail = detail


def not_found(code: str, message: str) -> ApiError:
    return ApiError(404, code, message)


def bad_request(code: str, message: str) -> ApiError:
    return ApiError(400, code, message)


def _body(code: str, message: str, detail: dict[str, str] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    # detail 은 없으면 키째로 뺀다 — 프론트 타입이 `detail?` 다
    if detail:
        body["detail"] = detail
    return body


# pydantic 이 내는 영어 사유는 화면에 그대로 띄울 수 없다. 자주 나오는 것만 옮긴다
_REASONS = {
    "missing": "필수 값입니다.",
    "string_too_short": "값을 입력해 주세요.",
    "string_too_long": "너무 깁니다.",
    "string_pattern_mismatch": "형식이 올바르지 않습니다.",
    "string_type": "글자로 넣어 주세요.",
    "int_parsing": "숫자로 넣어 주세요.",
    "bool_parsing": "참/거짓으로 넣어 주세요.",
    "date_parsing": "날짜 형식이 올바르지 않습니다.",
    "date_from_datetime_parsing": "날짜 형식이 올바르지 않습니다.",
    "literal_error": "고를 수 있는 값이 아닙니다.",
}

_HTTP_CODES = {
    404: ("NOT_FOUND", "요청한 경로를 찾을 수 없습니다."),
    405: ("METHOD_NOT_ALLOWED", "이 경로에서는 쓸 수 없는 방식입니다."),
}


async def _api_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return JSONResponse(
        status_code=exc.status_code, content=_body(exc.code, exc.message, exc.detail)
    )


async def _validation_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    detail: dict[str, str] = {}
    for err in exc.errors():
        # loc 은 ('body', 'name') 처럼 온다 — 화면이 쓰는 건 마지막 이름이다
        names = [part for part in err["loc"] if isinstance(part, str) and part != "body"]
        field = names[-1] if names else "요청"
        detail[field] = _REASONS.get(err["type"], err["msg"])
    return JSONResponse(
        status_code=422,
        content=_body("VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", detail),
    )


async def _http_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code, message = _HTTP_CODES.get(exc.status_code, ("HTTP_ERROR", "요청을 처리하지 못했습니다."))
    return JSONResponse(status_code=exc.status_code, content=_body(code, message))


async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    # 속사정은 싣지 않는다 — 로그로만 남는다
    return JSONResponse(
        status_code=500, content=_body("INTERNAL_ERROR", "서버에서 오류가 발생했습니다.")
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(Exception, _unhandled_error)
