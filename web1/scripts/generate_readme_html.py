#!/usr/bin/env python3
"""Generate README HTML wrapper for branch deployments."""

from __future__ import annotations

import datetime as _dt
import pathlib
import sys
import textwrap


def generate_readme_html(source: pathlib.Path, destination: pathlib.Path) -> None:
    content = source.read_text(encoding="utf-8")
    indented = "\n".join(f"    {line}" for line in content.splitlines())
    generated = _dt.datetime.now(tz=_dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    template = textwrap.dedent(
        f"""<!DOCTYPE html>
        <html lang=\"en\">
        <head>
          <meta charset=\"utf-8\">
          <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
          <title>Capy README</title>
          <style>
            :root {{
              color-scheme: light dark;
            }}
            body {{
              font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Oxygen, Ubuntu, Cantarell, \"Open Sans\", sans-serif;
              margin: 0 auto;
              padding: 32px 16px 48px;
              max-width: 920px;
              line-height: 1.6;
              background: #f6f8fa;
              color: #1f2328;
            }}
            a {{
              color: #0969da;
            }}
            .markdown-body {{
              background: #fff;
              border-radius: 12px;
              padding: 32px;
              box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
              border: 1px solid #d0d7de;
            }}
            .page-meta {{
              margin-top: 24px;
              font-size: 0.85em;
              color: #57606a;
              text-align: center;
            }}
            pre {{
              background: #0d1117;
              color: #f0f6fc;
              padding: 16px;
              border-radius: 8px;
              overflow-x: auto;
            }}
            code {{
              font-family: SFMono-Regular, Consolas, \"Liberation Mono\", Menlo, monospace;
            }}
            @media (max-width: 720px) {{
              .markdown-body {{
                padding: 24px 20px;
              }}
            }}
          </style>
        </head>
        <body>
          <main class=\"markdown-body\">
        {indented}
          </main>
          <footer class=\"page-meta\">Generated from README.md · {generated}</footer>
        </body>
        </html>
        """
    )

    destination.write_text(template, encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write(
            "Usage: generate_readme_html.py <temp_html_path> <output_path>\n"
        )
        return 1

    temp_html, output = map(pathlib.Path, argv)
    generate_readme_html(temp_html, output)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
