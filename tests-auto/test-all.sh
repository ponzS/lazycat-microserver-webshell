#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "${script_dir}/.." && pwd)"
runner="${script_dir}/run-playwright.mjs"

# Load repository-local dotenv defaults without overwriting variables supplied
# explicitly by the caller, so CI and one-off runs can still override them.
dotenv_file="${script_dir}/.env"
if [[ -f "${dotenv_file}" ]]; then
  while IFS= read -r dotenv_line || [[ -n "${dotenv_line}" ]]; do
    dotenv_line="${dotenv_line#${dotenv_line%%[![:space:]]*}}"
    [[ -z "${dotenv_line}" || "${dotenv_line:0:1}" == "#" || "${dotenv_line}" != *=* ]] && continue
    dotenv_key="${dotenv_line%%=*}"
    dotenv_value="${dotenv_line#*=}"
    [[ "${dotenv_key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    dotenv_value="${dotenv_value%${dotenv_value##*[![:space:]]}}"
    if [[ "${dotenv_value}" == \"*\" && "${dotenv_value}" == *\" ]]; then
      dotenv_value="${dotenv_value:1:${#dotenv_value}-2}"
    elif [[ "${dotenv_value}" == \'*\' && "${dotenv_value}" == *\' ]]; then
      dotenv_value="${dotenv_value:1:${#dotenv_value}-2}"
    fi
    if [[ -z "${!dotenv_key+x}" ]]; then
      export "${dotenv_key}=${dotenv_value}"
    fi
  done < "${dotenv_file}"
fi

mapfile -t cases < <(find "${script_dir}" -mindepth 2 -maxdepth 2 -type f -name test.mjs -printf '%h\n' | sort)
if (( ${#cases[@]} == 0 )); then
  echo "tests-auto: no test cases found" >&2
  exit 1
fi

for case_dir in "${cases[@]}"; do
  case_name="$(basename -- "${case_dir}")"
  echo "[tests-auto] START ${case_name}"
  node "${runner}" "${case_dir}/test.mjs"
  echo "[tests-auto] PASS  ${case_name}"
done

echo "[tests-auto] all ${#cases[@]} case(s) passed"
