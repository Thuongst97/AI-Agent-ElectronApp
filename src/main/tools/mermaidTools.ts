/**
 * Mermaid diagram rendering tool for the Copilot agent.
 *
 * The tool accepts a Mermaid diagram definition and returns it wrapped in
 * a ```mermaid code fence.  The renderer detects that language tag and
 * renders the SVG diagram inline in the chat bubble.
 *
 * Tools:
 *   render_mermaid_diagram → returns fenced mermaid code for inline rendering
 */

import { defineTool } from '@github/copilot-sdk'
import type { Tool }  from '@github/copilot-sdk'
import log from 'electron-log'

function normalizeMermaidForOutput(raw: string): string {
  return raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\s*\n/g, '\n')
    .replace(/[ \t]*\\$/gm, '')
    .trim()
}

export function makeMermaidTools(): Tool[] {
  return [

    defineTool('render_mermaid_diagram', {
      description:
        'Render a Mermaid diagram inline in the chat.  Use this whenever the user ' +
        'asks for a diagram, flowchart, sequence diagram, class diagram, ER diagram, ' +
        'Gantt chart, mind map, or any other visual that can be expressed in Mermaid ' +
        'syntax.  Provide raw Mermaid source only (no JSON string escaping, no ' +
        'backticks, no markdown fences) and the tool will display it as SVG in chat.',
      parameters: {
        type: 'object',
        properties: {
          diagram_code: {
            type: 'string',
            description:
              'The Mermaid diagram source code, e.g. "flowchart TD\\n  A-->B".',
          },
          title: {
            type: 'string',
            description: 'Optional short title shown above the diagram.',
          },
        },
        required: ['diagram_code'],
      },
      skipPermission: true,
      handler: async (args: any) => {
        const code  = normalizeMermaidForOutput((args.diagram_code as string).trim())
        const title = args.title ? (args.title as string).trim() : ''

        log.info('[render_mermaid_diagram] rendering diagram (%d chars)', code.length)

        const titleLine = title ? `**${title}**\n\n` : ''
        return `${titleLine}\`\`\`mermaid\n${code}\n\`\`\``
      },
    }),

  ]
}
