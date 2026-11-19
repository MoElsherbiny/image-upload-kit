import { describe, expect, it, vi } from 'vitest';
import { sanitizeSvg, UploadValidationError } from '../../src/server';

function sanitizeToString(svg: string, options?: Parameters<typeof sanitizeSvg>[1]): string {
  return sanitizeSvg(svg, options).toString('utf8');
}

describe('SVG allowlist sanitizer adversarial suite', () => {
  it('strips <script>, <foreignObject>, <iframe>, <object>, <embed>, and event handlers', () => {
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" onmouseover="evil()">
      <script>alert('xss')</script>
      <foreignObject width="100" height="100"><iframe src="https://evil.test"></iframe></foreignObject>
      <object data="https://evil.test/a.swf"></object>
      <embed src="https://evil.test/b.swf"/>
      <rect width="10" height="10" fill="#123456" onclick="alert(2)" xlink:onload="alert(3)"/>
    </svg>`;

    const out = sanitizeToString(hostile);
    expect(out).not.toMatch(/script|foreignObject|iframe|object|embed|onload|onclick|onmouseover|evil\.test/i);
    expect(out).toContain('<rect width="10" height="10" fill="#123456"/>');
  });

  it('strips javascript:, vbscript:, data:text/html, and data:image/svg+xml URIs (including entity-encoded)', () => {
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <use href="javascript:alert(1)"/>
      <use xlink:href="&#x6a;avascript:alert(2)"/>
      <use href="vbscript:msgbox(1)"/>
      <image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+" width="10" height="10"/>
      <image href="data:text/html;base64,PHNjcmlwdD4=" width="10" height="10"/>
      <use href="https://evil.example/sprite.svg#icon"/>
      <defs><rect id="safe-shape" width="8" height="8"/></defs>
      <use href="#safe-shape"/>
    </svg>`;

    const out = sanitizeToString(hostile);
    expect(out).not.toMatch(/javascript:|vbscript:|data:image\/svg|data:text\/html|evil\.example/i);
    expect(out).toContain('<use href="#safe-shape"/>');
  });

  it('sanitizes CSS @import, expression(), external url(), comments, and hex escapes in <style> and style=""', () => {
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        @import url("https://evil.example/x.css");
        .a { background: \\75 rl(https://evil.example/track.png); fill: url(#grad1); }
        .b { width: expr/*comment*/ession(alert(1)); background: \\6a avascript:alert(1); }
      </style>
      <rect class="a" style="fill: url(https://evil.example/a.svg#x); stroke: #000;" width="10" height="10"/>
      <circle cx="5" cy="5" r="4" fill="url(https://evil.example/p.svg#p)"/>
    </svg>`;

    const out = sanitizeToString(hostile);
    expect(out).not.toMatch(/@import|expression\s*\(|javascript:|evil\.example/i);
    expect(out).toContain('url(#grad1)');
    expect(out).toContain('fill="none"');
  });

  it('strips XXE <!DOCTYPE>, <!ENTITY>, custom entity refs, comments, CDATA, and PIs', () => {
    const hostile = `<?xml version="1.0"?>
      <?xml-stylesheet type="text/xsl" href="https://evil.example/x.xsl"?>
      <!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <!-- secret comment -->
      <svg xmlns="http://www.w3.org/2000/svg">
        <![CDATA[<script>alert(1)</script>]]>
        <title>Safe &amp; Clean &xxe;</title>
        <rect width="5" height="5"/>
      </svg>`;

    const out = sanitizeToString(hostile);
    expect(out).not.toMatch(/DOCTYPE|ENTITY|xxe|xml-stylesheet|CDATA|secret comment|<script/i);
    expect(out).toContain('<title>Safe &amp; Clean </title>');
    expect(out).toContain('<rect width="5" height="5"/>');
  });

  it('sanitizes nested <svg> and strips namespace-prefixed hostile tags like <xhtml:script>', () => {
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml">
      <xhtml:script>alert('ns')</xhtml:script>
      <svg onload="alert('nested')">
        <script>alert('nested-script')</script>
        <circle cx="10" cy="10" r="5" fill="#0f0"/>
      </svg>
    </svg>`;

    const out = sanitizeToString(hostile);
    expect(out).not.toMatch(/xhtml:script|<script|onload|xmlns:xhtml/i);
    expect(out).toContain('<circle cx="10" cy="10" r="5" fill="#0f0"/>');
  });

  it('rejects malformed XML, unclosed dangerous tags, and mismatched closing tags', () => {
    const malformedCases = [
      '<svg><script>alert(1)</svg>',
      '<svg><rect width="10"',
      '<svg><g><rect/></svg>',
      '<svg><rect width="10></rect></svg>',
      '<svg><!-- unclosed comment <rect/></svg>',
      '<div>not an svg</div>',
    ];

    for (const bad of malformedCases) {
      expect(() => sanitizeSvg(bad)).toThrow(UploadValidationError);
    }
  });

  it('invokes customSanitizer hook and still enforces allowlist and maxBytes', () => {
    const hook = vi.fn((svg: string) =>
      svg.replace('data-replace="yes"', 'fill="#abcdef"'),
    );

    const out = sanitizeToString(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect data-replace="yes" onclick="x()" width="10" height="10"/></svg>',
      { customSanitizer: hook },
    );

    expect(hook).toHaveBeenCalledTimes(1);
    expect(out).toContain('fill="#abcdef"');
    expect(out).not.toContain('onclick');
  });
});
