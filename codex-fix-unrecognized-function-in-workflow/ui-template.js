const RAW_HTML_SENTINEL = Symbol("capy:raw-html");

function escapeHtml(value) {
  if (value == null) {
    return "";
  }
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function serializeValue(value) {
  if (value == null || value === false) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue).join("");
  }
  if (value && typeof value === "object") {
    if (value.__kind === RAW_HTML_SENTINEL) {
      return value.value;
    }
    if (typeof value.toHTML === "function") {
      return serializeValue(value.toHTML());
    }
  }
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let result = "";
  for (let index = 0; index < strings.length; index += 1) {
    result += strings[index];
    if (index < values.length) {
      result += serializeValue(values[index]);
    }
  }
  return unsafeHTML(result);
}

export function unsafeHTML(value) {
  return { __kind: RAW_HTML_SENTINEL, value: String(value ?? "") };
}

export function renderTemplate(target, templateResult) {
  if (!target) return;
  let markup = "";
  if (templateResult && templateResult.__kind === RAW_HTML_SENTINEL) {
    markup = templateResult.value;
  } else if (typeof templateResult === "string") {
    markup = templateResult;
  } else if (templateResult != null) {
    markup = String(templateResult);
  }
  target.innerHTML = markup;
}
