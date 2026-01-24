/**
 * @import { JSResult, CSSResult } from "./types"
 */

/**
 * @typedef {Object} NodeTypeEnum
 * @property {1} DOCTYPE
 * @property {2} TEXT
 * @property {3} ELEMENT
 * @property {4} COMMENT
 */

/**
 * @typedef {Object} DoctypeNode
 * @property {typeof NODE_TYPE.DOCTYPE} ty - Node type (DOCTYPE)
 * @property {string} content - Doctype name
 */

/**
 * @typedef {Object} TextNode
 * @property {typeof NODE_TYPE.TEXT} ty - Node type (TEXT)
 * @property {string} content - Text content
 */

/**
 * @typedef {string | number | boolean | null | undefined} Primitive
 */

/**
 * @typedef {((props: Record<string, any>) => Promise<HTMLNode[] | Primitive>) & {
 *  js?: ()=> Promise<JSResult>
 *  css?: ()=> Promise<CSSResult>
 * }} ComponentFunction
 */

/**
 * @typedef {Object} ElementNode
 * @property {typeof NODE_TYPE.ELEMENT} ty - Node type (ELEMENT)
 * @property {string} tag - Tag name
 * @property {Record<string, any>} [attrs] - Element attributes
 * @property {(HTMLNode|ComponentNode)[]} [children] - Child nodes
 */

/**
 * @typedef {Object} CommentNode
 * @property {typeof NODE_TYPE.COMMENT} ty - Node type (COMMENT)
 * @property {string} content - Comment content
 */

/**
 * @typedef {DoctypeNode | TextNode | ElementNode | CommentNode} HTMLNode
 */

/**
 * @typedef {{
 *  nodes: HTMLNode[]
 *  js: JSResult;
 *  css: CSSResult;
 * }} HTMLResult
 */

const COMPONENT_NODE_TYPE = 0;

/**
 * @typedef {Object} ComponentNode
 * @property {typeof COMPONENT_NODE_TYPE} ty - Node type (component, internal use only)
 * @property {ComponentFunction} tag - Component function
 * @property {Record<string, any>} attrs - Component attributes (props)
 * @property {(HTMLNode|ComponentNode)[]} children - Component children
 */

/**
 * @typedef {Object} StackFrame
 * @property {string|Function} tag - Tag name or component function
 * @property {boolean} isComponent - Whether this is a component
 */

/**
 * `html` tagged template literal function specs
 *
 * - Tagged template literal function for HTML parsing. Supports components with `<${Component}>` syntax, where `Component` is a function which returns an html tree as defined below, or a primitive value (ie, string, null, undefined, boolean, number). Components may be async functions returning Promises.
 *   - Components can be async functions returning Promises.
 *   - Components can accept props as attributes, ie `<${Component} prop="value">` translates to `Component({prop: "value"})`.
 *   - Support for spread attributes, ie `<div ...${props}>` where `props` is an object containing key-value pairs to be added as attributes.
 *     - A spread can appear anywhere within the attribute list, and will be merged with the other attributes at that point so that it will take precedence over any earlier attributes but by overridden by any later attributes.
 *   - Support for dynamic attribute values, ie `<${Component} attr="${value}">` or `<div attr=${value}>` where `value` will be passed directly through to the component's props without being stringified.
 *   - Support for children passed as props, ie `<${Component}>child content</>` translates to `Component({children: [{ ty: "text", content: "child content" }]})`.
 *   - Component tags can be self-closing like `<${Component} />`, or closed with `</>`, `<//>` or `</${Component}>`.
 *   - If a component returns a primitive, that value should be coerced to a string and should be treated as text node content and not further parsed as HTML.
 *   - If a component returns an object which does not match the HTML tree structure, it should be stringified as "[object Object]" and treated as a text node.
 * - Parse HTML strings into nodes representing DOM elements
 * - Handle nested elements and attributes correctly
 * - Support self-closing tags and void elements
 *   - Closing tags for void elements should be ignored. For example, `<img></img>` should be treated as `<img>`.
 *     - Invalid HTML like `<img>content</img>` should treat "content" as a text node following the `<img>` element and ignore the closing tag.
 * - Support comments in the HTML input; they should be preserved in the output tree
 * - Whitespace should be preserved as in the original HTML; no trimming or collapsing.
 * - HTML entities (like `&amp;`, `&lt;`, etc.) and numeric character references (like `&#1234;` and `&#x1F600;`) will be preserved as-is in the output tree; they will not be decoded.
 * - Handle doctype declarations. The doctype should be represented as a node in the output tree, where the content is the doctype name (e.g. "html" for `<!DOCTYPE html>`).
 * - Provide meaningful error messages for malformed HTML. Error messages should include line and column numbers and a snippet of the problematic HTML where possible.
 * - Optimize for performance and memory usage
 * - Will run in Node 24+. No external dependencies.
 * - Designed to be used as part of a static site generator or server-side rendering engine.
 * - This will only produce static HTML output, so any values passed for event handler attributes like `onclick` will just be stringified in the output.
 * - `false` should be stringified as "false", but `null` and `undefined` should be treated as empty content; if an attribute is set to `null` or `undefined` it should be omitted entirely, and if a child is `null` or `undefined` it should not produce any output.
 * - Arrays passed as children should have their elements flattened into the parent.
 * - Objects passed as children should be stringified as "[object Object]", unless the object is a valid node in the tree structure, ie { ty: TEXT, content: "..." } or { ty: ELEMENT, tag: "...", attrs: { ... }, children: [ ... ] }. In that case it should be included as a normal node.
 * - Boolean attributes should be handled like so:
 *   - Just setting an attribute with no value (ie, `<input disabled>`) should be serialized as if it were set like `attr=${true}` (ie, `<input disabled=${true}>`).
 *   - If an attribute value is a raw boolean value like `true` or `false`, it should be rendered with no value for `true` and omitted entirely for `false`.
 *   - If an attribute is set to a stringified version of a boolean value, like `attr="true"` or `attr="false"`, it should be rendered as-is.
 * - Attributes with dashes or colons in their names will not be converted to camelCase; they should be preserved as-is but still passed as props to components.
 * - Mixed content (text nodes, dynamic content, and element nodes as siblings) should be supported. They will be represented in the tree structure as individual child nodes in the children array.
 * - Parsing should be forgiving, but fail immediately if it encounters unresolvable issues like unclosed tags, invalid syntax, or an error is thrown within a component.
 * - Parsing should return a tree structure representing the parsed HTML, which can then be serialized to a string or further processed as needed. It should render all components and replace them with their output in the final tree.
 * - Fragments do not need to be supported because multiple root nodes are allowed.
 * - Dynamic text values in attributes and child content should not be escaped; this will be handled at serialization time.
 * - Nested components should be supported and all resolved from the bottom up. That is, if a component returns another component, the inner component should be resolved first.
 *   - If a component produces a circular rendering loop where it renders a component which renders it again and so on, an error should be thrown after a max depth of 20 to prevent infinite loops.
 * - Empty attributes and children arrays should be omitted from the output tree for brevity.
 * - If duplicate attributes are set on an element, the last one takes precedence and overrides any previous values.
 *
 * The returned tree structure should look like this:
 * // <!DOCTYPE html>
 * // <div>
 * //   <!-- This is a comment -->
 * //   <h1>Hello, World!</h1>
 * // </div>
 * [
 *   { ty: DOCTYPE, content: 'html' },
 *   { ty: TEXT, content: '\n' },
 *   {
 *     ty: ELEMENT,
 *     tag: 'div',
 *     attrs: { id: 'main', class: 'container' },
 *     children: [
 *       { ty: TEXT, content: '\n  ' },
 *       { ty: COMMENT, content: ' This is a comment ' },
 *       { ty: TEXT, content: '\n  ' },
 *       {
 *         ty: ELEMENT,
 *         tag: 'h1',
 *         // attrs are omitted if there are none set on the element
 *         children: [
 *           {
 *             ty: TEXT,
 *             content: 'Hello, World!\n'
 *           },
 *         ],
 *       },
 *     ],
 *   },
 * ]
 *
 * Tree structure node types are enum constants defined as:
 * const NODE_TYPE = {
 *   DOCTYPE: 1,
 *   TEXT: 2,
 *   ELEMENT: 3,
 *   COMMENT: 4,
 * }
 *
 * The html tagged template literal function should return a Promise which resolves to the tree structure array.
 * Example usage:
 * const tree = await html`<!DOCTYPE html><div id="main"><h1>Hello, ${name}!</h1></div>`;
 */

/**
 * Node type enumeration
 * @type {NodeTypeEnum}
 */
const NODE_TYPE = {
  DOCTYPE: 1,
  TEXT: 2,
  ELEMENT: 3,
  COMMENT: 4,
};


const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

const PLACEHOLDER_PREFIX = '\x00PLACEHOLDER_';
const PLACEHOLDER_SUFFIX = '\x00';

/**
 * Merge CSS/JS results into target bundles and dependencies
 * @param {Record<string, string>} targetBundles - Target bundle object
 * @param {Set<string>} targetDeps - Target dependencies set
 * @param {Record<string, string>} sourceBundles - Source bundle object
 * @param {Set<string>} sourceDeps - Source dependencies set
 */
function mergeBundles(targetBundles, targetDeps, sourceBundles, sourceDeps) {
  for (const bundleName in sourceBundles) {
    targetBundles[bundleName] ??= '';
    targetBundles[bundleName] += `${sourceBundles[bundleName]}\n`;
  }
  for (const dep of sourceDeps) {
    targetDeps.add(dep);
  }
}

/**
 * Create an element node with optional attributes
 * @param {string} tag - Tag name
 * @param {Record<string, any>} attrs - Attributes object
 * @returns {ElementNode} Element node
 */
function createElementNode(tag, attrs) {
  /** @type {ElementNode} */
  const node = { ty: NODE_TYPE.ELEMENT, tag };
  if (Object.keys(attrs).length > 0) {
    node.attrs = attrs;
  }
  return node;
}

/**
 * Custom error class for HTML parsing errors
 */
class ParseError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} line - Line number where error occurred
   * @param {number} column - Column number where error occurred
   * @param {string} [snippet] - Code snippet showing error location
   */
  constructor(message, line, column, snippet) {
    const fullMessage = snippet
      ? `${message} at line ${line}, column ${column}\n${snippet}`
      : `${message} at line ${line}, column ${column}`;
    super(fullMessage);
    this.name = 'ParseError';
    /** @type {number} */
    this.line = line;
    /** @type {number} */
    this.column = column;
    /** @type {string|undefined} */
    this.snippet = snippet;
  }
}

/**
 * HTML parser class
 */
class Parser {
  /**
   * @param {string} html - HTML string to parse
   * @param {any[]} values - Dynamic values from template literal
   */
  constructor(html, values) {
    /** @type {string} */
    this.html = html;
    /** @type {any[]} */
    this.values = values;
    /** @type {number} */
    this.pos = 0;
    /** @type {number} */
    this.line = 1;
    /** @type {number} */
    this.column = 1;
    /** @type {StackFrame[]} */
    this.stack = [];
  }

  /**
   * Throw a parse error with current position information
   * @param {string} message - Error message
   * @throws {ParseError}
   */
  error(message) {
    const snippet = this.getSnippet();
    throw new ParseError(message, this.line, this.column, snippet);
  }

  /**
   * Get a snippet of HTML around the current position
   * @returns {string} HTML snippet with marker at current position
   */
  getSnippet() {
    const start = Math.max(0, this.pos - 40);
    const end = Math.min(this.html.length, this.pos + 40);
    const before = this.html.slice(start, this.pos);
    const after = this.html.slice(this.pos, end);
    return `...${before}⮕${after}...`;
  }

  /**
   * Look ahead at upcoming characters without advancing position
   * @param {number} [count=1] - Number of characters to peek
   * @returns {string} The peeked characters
   */
  peek(count = 1) {
    return this.html.slice(this.pos, this.pos + count);
  }

  /**
   * Advance the parser position, tracking line and column numbers
   * @param {number} [count=1] - Number of characters to advance
   */
  advance(count = 1) {
    for (let i = 0; i < count; i++) {
      if (this.html[this.pos] === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      this.pos++;
    }
  }

  /**
   * Skip whitespace characters at current position
   */
  skipWhitespace() {
    while (this.pos < this.html.length && /\s/.test(this.html[this.pos])) {
      this.advance();
    }
  }

  /**
   * Check if parser has reached the end of input
   * @returns {boolean} True if at end of input
   */
  isAtEnd() {
    return this.pos >= this.html.length;
  }

  /**
   * Parse a placeholder and return its value from the values array
   * @returns {any} The value from the placeholder
   * @throws {ParseError} If placeholder syntax is invalid
   */
  parsePlaceholder() {
    if (this.peek(PLACEHOLDER_PREFIX.length) !== PLACEHOLDER_PREFIX) {
      this.error('Expected placeholder');
    }

    this.advance(PLACEHOLDER_PREFIX.length);
    let indexStr = '';
    while (!this.isAtEnd() && this.peek() !== PLACEHOLDER_SUFFIX) {
      indexStr += this.html[this.pos];
      this.advance();
    }
    if (this.peek() !== PLACEHOLDER_SUFFIX) {
      this.error('Invalid placeholder');
    }
    this.advance(); // Skip suffix

    const index = parseInt(indexStr, 10);
    return this.values[index];
  }

  /**
   * Parse the entire HTML document
   * @returns {(HTMLNode|ComponentNode)[]} Array of parsed nodes (may contain unresolved components)
   * @throws {ParseError} If there are unclosed tags or parsing errors
   */
  parse() {    /** @type {(HtmlNode|ComponentNode)[]} */    const nodes = [];
    while (!this.isAtEnd()) {
      const node = this.parseNode();
      if (node !== null && node !== undefined) {
        if (Array.isArray(node)) {
          nodes.push(...node);
        } else {
          nodes.push(node);
        }
      }
    }

    if (this.stack.length > 0) {
      const unclosedTag = this.stack[this.stack.length - 1];
      this.error(`Unclosed tag <${unclosedTag.tag}>`);
    }

    return nodes;
  }

  /**
   * Parse a single node (element, text, comment, or doctype)
   * @returns {HTMLNode|ComponentNode|(HTMLNode|ComponentNode)[]|null} Parsed node(s)
   */
  parseNode() {
    if (this.peek(2) === '<!') {
      if (this.peek(9).toLowerCase() === '<!doctype') {
        return this.parseDoctype();
      } else if (this.peek(4) === '<!--') {
        return this.parseComment();
      }
    }

    if (this.peek() === '<') {
      return this.parseElement();
    }

    return this.parseText();
  }

  /**
   * Parse a DOCTYPE declaration
   * @returns {DoctypeNode} Doctype node
   * @throws {ParseError} If DOCTYPE is unclosed
   */
  parseDoctype() {
    this.advance(9); // Skip '<!doctype'
    this.skipWhitespace();

    let doctype = '';
    while (!this.isAtEnd() && this.peek() !== '>') {
      doctype += this.html[this.pos];
      this.advance();
    }

    if (this.peek() !== '>') {
      this.error('Unclosed DOCTYPE declaration');
    }
    this.advance(); // Skip '>'

    return { ty: NODE_TYPE.DOCTYPE, content: doctype.trim() };
  }

  /**
   * Parse an HTML comment
   * @returns {CommentNode} Comment node
   * @throws {ParseError} If comment is unclosed
   */
  parseComment() {
    this.advance(4); // Skip '<!--'

    let content = '';
    while (!this.isAtEnd() && this.peek(3) !== '-->') {
      content += this.html[this.pos];
      this.advance();
    }

    if (this.peek(3) !== '-->') {
      this.error('Unclosed comment');
    }
    this.advance(3); // Skip '-->'

    return { ty: NODE_TYPE.COMMENT, content };
  }

  /**
   * Parse an HTML element or component
   * @returns {ElementNode|ComponentNode} Element or component node
   * @throws {ParseError} If element syntax is invalid
   */
  parseElement() {
    this.advance(); // Skip '<'

    // Check for closing tag
    if (this.peek() === '/') {
      this.parseClosingTag();
      // This line is never reached because parseClosingTag always throws
      throw new Error('Unreachable');
    }

    // Parse tag name or component placeholder
    const tagStart = this.pos;
    let tag = null;
    let isComponent = false;

    if (this.peek(PLACEHOLDER_PREFIX.length) === PLACEHOLDER_PREFIX) {
      // This is a component placeholder
      tag = this.parsePlaceholder();
      isComponent = true;
    } else {
      // Regular HTML tag
      while (!this.isAtEnd() && /[a-zA-Z0-9\-_:]/.test(this.peek())) {
        this.advance();
      }
      tag = this.html.slice(tagStart, this.pos);

      if (!tag) {
        this.error('Expected tag name');
      }
    }

    // Parse attributes
    const attrs = this.parseAttributes();

    this.skipWhitespace();

    // Check for self-closing tag
    if (this.peek(2) === '/>') {
      this.advance(2);

      if (isComponent) {
        return { ty: COMPONENT_NODE_TYPE, tag, attrs, children: [] };
      }

      return createElementNode(tag, attrs);
    }

    if (this.peek() !== '>') {
      this.error('Expected ">" or "/>"');
    }
    this.advance(); // Skip '>'

    // For void elements, don't expect children or closing tag
    if (!isComponent && VOID_ELEMENTS.has(tag)) {
      return createElementNode(tag, attrs);
    }

    // Parse children
    /** @type {(HTMLNode|ComponentNode)[]} */
    const children = [];
    this.stack.push({ tag, isComponent });

    while (!this.isAtEnd()) {
      // Check for closing tag
      if (this.peek() === '<' && this.peek(2) === '</') {
        const savedPos = this.pos;
        const savedLine = this.line;
        const savedColumn = this.column;

        this.advance(2); // Skip '</'

        // Check for </>, <//>, or </${Component}>
        if (this.peek() === '>') {
          // </>
          this.advance();
          this.stack.pop();
          break;
        } else if (this.peek(2) === '/>') {
          // <//>
          this.advance(2);
          this.stack.pop();
          break;
        } else if (this.peek(PLACEHOLDER_PREFIX.length) === PLACEHOLDER_PREFIX) {
          // Component closing tag
          this.parsePlaceholder();

          this.skipWhitespace();
          if (this.peek() !== '>') {
            this.error('Expected ">" in closing tag');
          }
          this.advance();

          this.stack.pop();
          break;
        } else {
          // Regular closing tag
          const closeTagStart = this.pos;
          while (!this.isAtEnd() && this.peek() !== '>') {
            this.advance();
          }
          const closeTag = this.html.slice(closeTagStart, this.pos);

          if (this.peek() !== '>') {
            this.error('Expected ">" in closing tag');
          }
          this.advance();

          // Check if this is the matching closing tag
          if ((!isComponent && closeTag === tag) || (isComponent && false)) {
            this.stack.pop();
            break;
          } else if (!isComponent && VOID_ELEMENTS.has(closeTag)) {
            // Ignore closing tags for void elements
            continue;
          } else {
            // This closing tag doesn't match, put it back and let parent handle it
            this.pos = savedPos;
            this.line = savedLine;
            this.column = savedColumn;

            // Check if this might be our parent's closing tag
            let matchesAncestor = false;
            for (let i = this.stack.length - 2; i >= 0; i--) {
              if (!this.stack[i].isComponent && this.stack[i].tag === closeTag) {
                matchesAncestor = true;
                break;
              }
            }

            if (matchesAncestor) {
              this.stack.pop();
              break;
            } else {
              // Unknown closing tag, just ignore it
              this.pos = savedPos + 2;
              while (!this.isAtEnd() && this.peek() !== '>') {
                this.advance();
              }
              if (this.peek() === '>') {
                this.advance();
              }
              continue;
            }
          }
        }
      }

      const child = this.parseNode();
      if (child !== null && child !== undefined) {
        if (Array.isArray(child)) {
          children.push(...child);
        } else {
          children.push(child);
        }
      }
    }

    if (isComponent) {
      return { ty: COMPONENT_NODE_TYPE, tag, attrs, children };
    }

    /** @type {ElementNode} */
    const node = { ty: NODE_TYPE.ELEMENT, tag };
    if (Object.keys(attrs).length > 0) {
      node.attrs = attrs;
    }
    if (children.length > 0) {
      node.children = children;
    }
    return node;
  }

  /**
   * Handle unexpected closing tags
   * @returns {void}
   * @throws {ParseError} Always throws
   */
  parseClosingTag() {
    // This shouldn't be called directly as it's handled in parseElement
    this.error('Unexpected closing tag');
  }

  /**
   * Parse element attributes including spread attributes
   * @returns {Record<string, any>} Object containing attribute key-value pairs
   * @throws {ParseError} If attribute syntax is invalid
   */
  parseAttributes() {
    /** @type {Record<string, any>} */
    const attrs = {};

    while (!this.isAtEnd()) {
      this.skipWhitespace();

      const ch = this.peek();
      if (ch === '>' || ch === '/' || ch === '') {
        break;
      }

      // Check for spread attribute
      if (this.peek(3) === '...') {
        this.advance(3);

        if (this.peek(PLACEHOLDER_PREFIX.length) !== PLACEHOLDER_PREFIX) {
          this.error('Expected placeholder after "..."');
        }

        const spreadObj = this.parsePlaceholder();

        if (spreadObj && typeof spreadObj === 'object' && !Array.isArray(spreadObj)) {
          Object.assign(attrs, spreadObj);
        }

        continue;
      }

      // Parse attribute name
      const nameStart = this.pos;
      while (!this.isAtEnd() && /[a-zA-Z0-9\-_:]/.test(this.peek())) {
        this.advance();
      }
      const name = this.html.slice(nameStart, this.pos);

      if (!name) {
        break;
      }

      this.skipWhitespace();

      // Check for attribute value
      if (this.peek() === '=') {
        this.advance(); // Skip '='
        this.skipWhitespace();

        const valueStart = this.peek();

        if (valueStart === '"' || valueStart === "'") {
          // Quoted attribute value
          const quote = valueStart;
          this.advance(); // Skip opening quote

          let value = '';
          while (!this.isAtEnd() && this.peek() !== quote) {
            if (this.peek(PLACEHOLDER_PREFIX.length) === PLACEHOLDER_PREFIX) {
              // Dynamic value in attribute
              const dynValue = this.parsePlaceholder();

              if (dynValue === null || dynValue === undefined) {
                // Skip this attribute
                if (this.peek() === quote) {
                  this.advance();
                }
                continue;
              }

              value += String(dynValue);
            } else {
              value += this.html[this.pos];
              this.advance();
            }
          }

          if (this.peek() !== quote) {
            this.error('Unclosed attribute value');
          }
          this.advance(); // Skip closing quote

          attrs[name] = value;
        } else if (this.peek(PLACEHOLDER_PREFIX.length) === PLACEHOLDER_PREFIX) {
          // Unquoted dynamic attribute value
          const dynValue = this.parsePlaceholder();

          if (dynValue === null || dynValue === undefined) {
            // Skip this attribute
            continue;
          }

          if (dynValue === false) {
            // Omit attribute
            continue;
          }

          attrs[name] = dynValue;
        } else {
          // Unquoted attribute value
          const valueStart = this.pos;
          while (!this.isAtEnd() && !/[\s>\/]/.test(this.peek())) {
            this.advance();
          }
          attrs[name] = this.html.slice(valueStart, this.pos);
        }
      } else {
        // Boolean attribute
        attrs[name] = true;
      }
    }

    return attrs;
  }

  /**
   * Parse text content, handling dynamic values
   * @returns {TextNode|(HTMLNode|ComponentNode)[]|HTMLNode|ComponentNode|null} Text node, array of nodes, or null
   * @throws {ParseError} If placeholder syntax is invalid
   */
  parseText() {
    let text = '';

    while (!this.isAtEnd() && this.peek() !== '<') {
      if (this.peek(PLACEHOLDER_PREFIX.length) === PLACEHOLDER_PREFIX) {
        // Dynamic value in text
        const dynValue = this.parsePlaceholder();

        // If we have accumulated text, emit it first
        if (text) {
          const textNode = { ty: NODE_TYPE.TEXT, content: text };
          text = '';

          // Process dynamic value
          const dynNodes = this.processDynamicValue(dynValue);
          if (Array.isArray(dynNodes)) {
            return [textNode, ...dynNodes];
          } else if (dynNodes !== null && dynNodes !== undefined) {
            return [textNode, dynNodes];
          } else {
            return textNode;
          }
        } else {
          // No accumulated text, just return dynamic value
          const dynNodes = this.processDynamicValue(dynValue);
          return dynNodes;
        }
      } else {
        text += this.html[this.pos];
        this.advance();
      }
    }

    if (text) {
      return { ty: NODE_TYPE.TEXT, content: text };
    }

    return null;
  }

  /**
   * Process a dynamic value into one or more nodes
   * @param {any} value - Dynamic value to process
   * @returns {HTMLNode|ComponentNode|(HTMLNode|ComponentNode)[]|null} Processed node(s)
   */
  processDynamicValue(value) {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      return value.flatMap(v => this.processDynamicValue(v)).filter(v => v !== null && v !== undefined);
    }

    if (typeof value === 'object') {
      // Check if it's a valid tree node
      if (value.ty && (value.ty === NODE_TYPE.TEXT || value.ty === NODE_TYPE.ELEMENT ||
        value.ty === NODE_TYPE.COMMENT || value.ty === NODE_TYPE.DOCTYPE)) {
        return value;
      }
      // Invalid object, stringify it
      return { ty: NODE_TYPE.TEXT, content: String(value) };
    }

    // Primitive value
    return { ty: NODE_TYPE.TEXT, content: String(value) };
  }
}

/**
 * Recursively resolve all components in the node tree
 * @param {(HTMLNode|ComponentNode)[]} nodes - Nodes to resolve
 * @param {number} [depth=0] - Current nesting depth
 * @returns {Promise<HTMLResult>} Resolved nodes with all components expanded
 * @throws {Error} If max depth exceeded or component throws error
 */
async function resolveComponents(nodes, depth = 0) {
  if (depth > 20) {
    throw new Error('Maximum component nesting depth exceeded (20). Possible circular reference.');
  }

  /** @type {HTMLNode[]} */
  const resolvedNodes = [];

  /**
   * @type {Record<string, string>}
   */
  const cssBundles = {};
  /**
   * @type {Set<string>}
   */
  const cssDependencies = new Set();

  /**
   * @type {Record<string, string>}
   */
  const jsBundles = {};
  /**
   * @type {Set<string>}
   */
  const jsDependencies = new Set();

  for (const node of nodes) {
    switch (node.ty) {
      case COMPONENT_NODE_TYPE: {
        const { tag, attrs, children } = node;

        // Resolve children first (bottom-up)
        const {
          nodes: resolvedChildren,
          css: childCSS,
          js: childJS
        } = await resolveComponents(children, depth + 1);

        // Call component function
        const props = { ...attrs };
        if (resolvedChildren.length > 0) {
          props.children = resolvedChildren;
        }

        mergeBundles(cssBundles, cssDependencies, childCSS.cssBundles, childCSS.cssDependencies);
        mergeBundles(jsBundles, jsDependencies, childJS.jsBundles, childJS.jsDependencies);

        /** @type {unknown} */
        let result;
        try {
          result = await tag(props);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Error in component: ${message}`);
        }

        // Merge in any CSS/JS attached to the component
        if (tag.css) {
          try {
            const cssResult = await tag.css();
            mergeBundles(cssBundles, cssDependencies, cssResult.cssBundles, cssResult.cssDependencies);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Error in component CSS: ${message}`);
          }
        }
        if (tag.js) {
          try {
            const jsResult = await tag.js();
            mergeBundles(jsBundles, jsDependencies, jsResult.jsBundles, jsResult.jsDependencies);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Error in component JS: ${message}`);
          }
        }

        // Process component result
        if (result === null || result === undefined) {
          continue;
        }

        if (Array.isArray(result)) {
          // Recursively resolve any nested components
          const {
            nodes: nestedNodes,
            css: nestedCSS,
            js: nestedJS,
          } = await resolveComponents(result, depth + 1);
          resolvedNodes.push(...nestedNodes);
          mergeBundles(cssBundles, cssDependencies, nestedCSS.cssBundles, nestedCSS.cssDependencies);
          mergeBundles(jsBundles, jsDependencies, nestedJS.jsBundles, nestedJS.jsDependencies);
        } else if (typeof result === 'object' && "ty" in result) {
          switch (result.ty) {
            case NODE_TYPE.ELEMENT:
              // Resolve children of the element
              if ('children' in result && Array.isArray(result.children)) {
                result.children = await resolveComponents(result.children, depth + 1);
              }
              resolvedNodes.push(/** @type {HTMLNode} */(result));
              break;
            case NODE_TYPE.TEXT:
            case NODE_TYPE.COMMENT:
            case NODE_TYPE.DOCTYPE:
              resolvedNodes.push(/** @type {HTMLNode} */(result));
              break;
            case COMPONENT_NODE_TYPE:
              // Nested component, resolve it
              const {
                nodes: nestedNodes,
                css: nestedCSS,
                js: nestedJS,
              } = await resolveComponents([/** @type {ComponentNode} */ (result)], depth + 1);
              resolvedNodes.push(...nestedNodes);
              mergeBundles(cssBundles, cssDependencies, nestedCSS.cssBundles, nestedCSS.cssDependencies);
              mergeBundles(jsBundles, jsDependencies, nestedJS.jsBundles, nestedJS.jsDependencies);
              break;
            default:
              // Invalid node type
              resolvedNodes.push({ ty: NODE_TYPE.TEXT, content: String(result) });
              break;
          }
        } else {
          // Primitive value
          resolvedNodes.push({ ty: NODE_TYPE.TEXT, content: String(result) });
        }
        break;
      }
      case NODE_TYPE.ELEMENT: {
        const newNode = { .../** @type {ElementNode} */ (node) };
        if (node.children) {
          // Regular element, resolve its children
          const {
            nodes: resolvedChildren,
            css: childCSS,
            js: childJS
          } = await resolveComponents(node.children, depth);
          if (resolvedChildren.length > 0) {
            newNode.children = resolvedChildren;
          } else {
            delete newNode.children;
          }
          mergeBundles(cssBundles, cssDependencies, childCSS.cssBundles, childCSS.cssDependencies);
          mergeBundles(jsBundles, jsDependencies, childJS.jsBundles, childJS.jsDependencies);
        }
        resolvedNodes.push(newNode);
        break;
      }
      default: {
        resolvedNodes.push(/** @type {HTMLNode} */(node));
        break;
      }
    }
  }

  return {
    nodes: resolvedNodes,
    css: {
      cssBundles,
      cssDependencies
    },
    js: {
      jsBundles,
      jsDependencies
    }
  };
}


/**
 * Tagged template literal function for parsing HTML with component support
 * @param {TemplateStringsArray} strings - Template string array
 * @param {...any} values - Dynamic values
 * @returns {Promise<HTMLResult>} Parsed and resolved HTML result
 * @throws {ParseError} If HTML syntax is invalid
 * @throws {Error} If component resolution fails
 */
export async function html(strings, ...values) {
  // Build the HTML string with placeholders for dynamic values
  let htmlString = '';
  for (let i = 0; i < strings.length; i++) {
    htmlString += strings[i];
    if (i < values.length) {
      htmlString += `${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_SUFFIX}`;
    }
  }

  // Parse the HTML
  const parser = new Parser(htmlString, values);
  let tree;
  try {
    tree = parser.parse();
  } catch (error) {
    if (error instanceof ParseError) {
      throw error;
    }
    throw new Error(`Encountered an unknown error during parsing.`, {
      cause: error
    });
  }

  // Resolve all components
  const resolved = await resolveComponents(tree);

  return resolved;
}

export { NODE_TYPE };