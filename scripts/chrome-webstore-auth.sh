#!/usr/bin/env bash
#
# chrome-webstore-auth.sh
# Получение OAuth2 credentials для Chrome Web Store API
#
# Использование:
#   ./chrome-webstore-auth.sh
#   ./chrome-webstore-auth.sh --save-bitwarden
#
# Переменные окружения (опционально):
#   CHROME_WEBSTORE_CLIENT_ID     - OAuth Client ID
#   CHROME_WEBSTORE_CLIENT_SECRET - OAuth Client Secret
#

set -euo pipefail

# ============================================================================
# Конфигурация
# ============================================================================

readonly SCRIPT_NAME="chrome-webstore-auth"
readonly PORT=8085
readonly REDIRECT_URI="http://localhost:${PORT}"
readonly AUTH_URL="https://accounts.google.com/o/oauth2/auth"
readonly TOKEN_URL="https://oauth2.googleapis.com/token"
readonly SCOPE="https://www.googleapis.com/auth/chromewebstore"

# Цвета
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# ============================================================================
# Утилиты
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

die() {
    log_error "$@"
    exit 1
}

# ============================================================================
# Проверки
# ============================================================================

check_dependencies() {
    log_info "Проверка зависимостей..."

    # jq
    if ! command -v jq &>/dev/null; then
        die "jq не установлен. Установи: brew install jq"
    fi
    log_success "jq установлен"

    # nc (netcat) для простого HTTP сервера
    if ! command -v nc &>/dev/null; then
        die "nc (netcat) не найден"
    fi
    log_success "netcat доступен"

    # open (macOS)
    if ! command -v open &>/dev/null; then
        die "Команда 'open' не найдена (требуется macOS)"
    fi
    log_success "браузер доступен"

    # curl
    if ! command -v curl &>/dev/null; then
        die "curl не установлен"
    fi
    log_success "curl установлен"
}

check_port_available() {
    if lsof -i ":${PORT}" &>/dev/null; then
        die "Порт ${PORT} уже занят. Освободи порт и попробуй снова."
    fi
    log_success "Порт ${PORT} свободен"
}

# ============================================================================
# Получение credentials
# ============================================================================

get_credentials() {
    log_info "Получение OAuth credentials..."

    # Попытка из переменных окружения
    if [[ -n "${CHROME_WEBSTORE_CLIENT_ID:-}" ]] && [[ -n "${CHROME_WEBSTORE_CLIENT_SECRET:-}" ]]; then
        CLIENT_ID="$CHROME_WEBSTORE_CLIENT_ID"
        CLIENT_SECRET="$CHROME_WEBSTORE_CLIENT_SECRET"
        log_success "Credentials получены из переменных окружения"
        return 0
    fi

    # Интерактивный ввод
    echo ""
    echo -e "${YELLOW}OAuth credentials не найдены в ENV.${NC}"
    echo "Введи данные из Google Cloud Console (APIs & Services > Credentials):"
    echo ""

    read -rp "Client ID: " CLIENT_ID
    if [[ -z "$CLIENT_ID" ]]; then
        die "Client ID не может быть пустым"
    fi

    read -rsp "Client Secret: " CLIENT_SECRET
    echo ""
    if [[ -z "$CLIENT_SECRET" ]]; then
        die "Client Secret не может быть пустым"
    fi

    log_success "Credentials введены"
}

# ============================================================================
# OAuth Flow
# ============================================================================

start_callback_server() {
    local callback_file="$1"

    # Простой HTTP сервер для получения callback
    # Используем bash + nc для минимализма
    {
        # Ждём подключения и читаем HTTP запрос
        while true; do
            # Создаём именованный pipe
            local pipe_file="/tmp/${SCRIPT_NAME}-pipe-$$"
            rm -f "$pipe_file"
            mkfifo "$pipe_file"

            # Читаем запрос и формируем ответ
            (
                read -r request_line < "$pipe_file"

                # Парсим code из URL
                if [[ "$request_line" =~ code=([^\ \&]+) ]]; then
                    local code="${BASH_REMATCH[1]}"
                    echo "$code" > "$callback_file"

                    # HTML ответ
                    local response_body="<html><head><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a1a;color:#fff}div{text-align:center}h1{color:#4ade80}</style></head><body><div><h1>Авторизация успешна!</h1><p>Можешь закрыть это окно и вернуться в терминал.</p></div></body></html>"
                    local content_length=${#response_body}

                    printf "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s" "$content_length" "$response_body"
                else
                    # Ошибка или другой запрос
                    if [[ "$request_line" =~ error=([^\ \&]+) ]]; then
                        echo "ERROR:${BASH_REMATCH[1]}" > "$callback_file"
                    fi
                    printf "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nNo code found"
                fi
            ) | nc -l "$PORT" > "$pipe_file" 2>/dev/null

            rm -f "$pipe_file"

            # Если получили код — выходим
            if [[ -f "$callback_file" ]]; then
                break
            fi
        done
    } &

    echo $!
}

authorize() {
    local callback_file="/tmp/${SCRIPT_NAME}-callback-$$"
    rm -f "$callback_file"

    # URL для авторизации
    local auth_params="client_id=${CLIENT_ID}"
    auth_params+="&redirect_uri=${REDIRECT_URI}"
    auth_params+="&response_type=code"
    auth_params+="&scope=${SCOPE}"
    auth_params+="&access_type=offline"
    auth_params+="&prompt=consent"

    local full_auth_url="${AUTH_URL}?${auth_params}"

    log_info "Запуск callback сервера на порту ${PORT}..."
    local server_pid
    server_pid=$(start_callback_server "$callback_file")

    # Даём серверу время запуститься
    sleep 1

    log_info "Открытие браузера для авторизации..."
    echo ""
    echo -e "${YELLOW}Если браузер не открылся, перейди по ссылке:${NC}"
    echo "$full_auth_url"
    echo ""

    open "$full_auth_url" 2>/dev/null || true

    log_info "Ожидание авторизации (callback на http://localhost:${PORT})..."

    # Ждём callback (таймаут 5 минут)
    local timeout=300
    local elapsed=0
    while [[ ! -f "$callback_file" ]] && (( elapsed < timeout )); do
        sleep 1
        ((elapsed++))
    done

    # Убиваем сервер
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true

    if [[ ! -f "$callback_file" ]]; then
        die "Таймаут ожидания авторизации (${timeout}s)"
    fi

    local callback_result
    callback_result=$(cat "$callback_file")
    rm -f "$callback_file"

    if [[ "$callback_result" == ERROR:* ]]; then
        die "Ошибка авторизации: ${callback_result#ERROR:}"
    fi

    AUTH_CODE="$callback_result"
    log_success "Authorization code получен"
}

exchange_code_for_tokens() {
    log_info "Обмен authorization code на токены..."

    local response
    response=$(curl -s -X POST "$TOKEN_URL" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "client_id=${CLIENT_ID}" \
        -d "client_secret=${CLIENT_SECRET}" \
        -d "code=${AUTH_CODE}" \
        -d "grant_type=authorization_code" \
        -d "redirect_uri=${REDIRECT_URI}")

    # Проверяем на ошибки
    if echo "$response" | jq -e '.error' &>/dev/null; then
        local error_desc
        error_desc=$(echo "$response" | jq -r '.error_description // .error')
        die "Ошибка получения токенов: $error_desc"
    fi

    ACCESS_TOKEN=$(echo "$response" | jq -r '.access_token')
    REFRESH_TOKEN=$(echo "$response" | jq -r '.refresh_token')
    EXPIRES_IN=$(echo "$response" | jq -r '.expires_in')

    if [[ -z "$ACCESS_TOKEN" ]] || [[ "$ACCESS_TOKEN" == "null" ]]; then
        die "Не удалось получить access_token. Ответ: $response"
    fi

    if [[ -z "$REFRESH_TOKEN" ]] || [[ "$REFRESH_TOKEN" == "null" ]]; then
        log_warn "refresh_token не получен. Возможно, приложение уже авторизовано."
        log_warn "Попробуй отозвать доступ: https://myaccount.google.com/permissions"
        REFRESH_TOKEN=""
    fi

    log_success "Токены получены (expires_in: ${EXPIRES_IN}s)"
}

# ============================================================================
# Вывод и сохранение
# ============================================================================

output_credentials() {
    echo ""
    echo "============================================================"
    echo -e "${GREEN}CREDENTIALS ДЛЯ GITHUB SECRETS${NC}"
    echo "============================================================"
    echo ""
    echo "Добавь в GitHub Repository Settings > Secrets and variables > Actions:"
    echo ""
    echo -e "${YELLOW}CHROME_WEBSTORE_CLIENT_ID${NC}"
    echo "$CLIENT_ID"
    echo ""
    echo -e "${YELLOW}CHROME_WEBSTORE_CLIENT_SECRET${NC}"
    echo "$CLIENT_SECRET"
    echo ""
    echo -e "${YELLOW}CHROME_WEBSTORE_REFRESH_TOKEN${NC}"
    if [[ -n "$REFRESH_TOKEN" ]]; then
        echo "$REFRESH_TOKEN"
    else
        echo "(не получен — см. предупреждение выше)"
    fi
    echo ""
    echo "============================================================"
    echo ""
    echo -e "${BLUE}Дополнительно (для тестирования):${NC}"
    echo ""
    echo "ACCESS_TOKEN (истекает через ${EXPIRES_IN}s):"
    echo "$ACCESS_TOKEN"
    echo ""
}

save_to_bitwarden() {
    if ! command -v bw-get &>/dev/null; then
        log_warn "bw-get не найден, пропускаю сохранение в Bitwarden"
        return 0
    fi

    log_info "Сохранение в Bitwarden..."

    # Формируем JSON с credentials
    local creds_json
    creds_json=$(jq -n \
        --arg client_id "$CLIENT_ID" \
        --arg client_secret "$CLIENT_SECRET" \
        --arg refresh_token "${REFRESH_TOKEN:-}" \
        --arg access_token "$ACCESS_TOKEN" \
        '{
            client_id: $client_id,
            client_secret: $client_secret,
            refresh_token: $refresh_token,
            access_token: $access_token
        }')

    if bw-get --create "chrome-webstore-api" "$creds_json" 2>/dev/null; then
        log_success "Сохранено в Bitwarden как 'chrome-webstore-api'"
    else
        log_warn "Не удалось сохранить в Bitwarden"
    fi
}

# ============================================================================
# Главная функция
# ============================================================================

main() {
    local save_bitwarden=false

    # Парсинг аргументов
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --save-bitwarden|-b)
                save_bitwarden=true
                shift
                ;;
            --help|-h)
                echo "Использование: $0 [--save-bitwarden]"
                echo ""
                echo "Опции:"
                echo "  --save-bitwarden, -b  Сохранить credentials в Bitwarden"
                echo "  --help, -h            Показать эту справку"
                echo ""
                echo "Переменные окружения:"
                echo "  CHROME_WEBSTORE_CLIENT_ID      OAuth Client ID"
                echo "  CHROME_WEBSTORE_CLIENT_SECRET  OAuth Client Secret"
                exit 0
                ;;
            *)
                die "Неизвестный аргумент: $1"
                ;;
        esac
    done

    echo ""
    echo "============================================================"
    echo "  Chrome Web Store API - OAuth2 Authorization"
    echo "============================================================"
    echo ""

    check_dependencies
    check_port_available
    get_credentials
    authorize
    exchange_code_for_tokens
    output_credentials

    if $save_bitwarden; then
        save_to_bitwarden
    fi

    echo -e "${GREEN}Готово!${NC}"
    echo ""
}

main "$@"
