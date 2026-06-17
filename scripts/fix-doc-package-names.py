from pathlib import Path
import re

docs = Path(__file__).resolve().parents[1] / 'docs'

mapping = {
    'core': 'koishi-plugin-core',
    'behavior': 'koishi-plugin-behavior',
    'brain': 'koishi-plugin-brain',
    'dialogue': 'koishi-plugin-dialogue',
    'cognition': 'koishi-plugin-cognition',
    'homeostasis': 'koishi-plugin-homeostasis',
    'model-gateway': 'koishi-plugin-model-gateway',
    'observatory': 'koishi-plugin-observatory',
    'perception': 'koishi-plugin-perception',
    'persona': 'koishi-plugin-persona',
    'shared': 'koishi-plugin-shared',
}

package_pattern = re.compile(
    r'(?<!packages/)@elysia-ai/'
    r'(core|behavior|brain|dialogue|cognition|homeostasis|model-gateway|observatory|perception|persona|shared)'
)
generic_pattern = re.compile(r'(?<!packages/)@elysia-ai/\*')

changed: list[str] = []

for path in sorted(docs.glob('*.md')):
    content = path.read_text(encoding='utf-8')
    updated = content

    updated = package_pattern.sub(
        lambda match: f'@elysia-ai/{mapping[match.group(1)]}',
        updated,
    )
    updated = generic_pattern.sub('@elysia-ai/koishi-plugin-*', updated)
    updated = updated.replace('@elysia-ai/<name>', '@elysia-ai/koishi-plugin-<name>')

    if updated != content:
        path.write_text(updated, encoding='utf-8')
        changed.append(str(path.relative_to(docs.parent)))

print('\n'.join(changed))
