const utils = require("./utils");

function isPrefixInScope(prefixesInScope, prefix, namespaceURI) {
  let ret = false;
  prefixesInScope.forEach(function (pf) {
    if (pf.prefix === prefix && pf.namespaceURI === namespaceURI) {
      ret = true;
    }
  });

  return ret;
}

/**
 * @type { import("../index.d.ts").CanonicalizationOrTransformationAlgorithm}
 */
class ExclusiveCanonicalization {
  constructor() {
    this.includeComments = false;
  }

  attrCompare(a, b) {
    if (!a.namespaceURI && b.namespaceURI) {
      return -1;
    }
    if (!b.namespaceURI && a.namespaceURI) {
      return 1;
    }

    const left = a.namespaceURI + a.localName;
    const right = b.namespaceURI + b.localName;

    if (left === right) {
      return 0;
    } else if (left < right) {
      return -1;
    } else {
      return 1;
    }
  }

  nsCompare(a, b) {
    const attr1 = a.prefix;
    const attr2 = b.prefix;
    if (attr1 === attr2) {
      return 0;
    }
    return attr1.localeCompare(attr2);
  }

  renderAttrs(node) {
    let i;
    let attr;
    const res = [];
    const attrListToRender = [];

    if (node.nodeType === 8) {
      return this.renderComment(node);
    }

    if (node.attributes) {
      for (i = 0; i < node.attributes.length; ++i) {
        attr = node.attributes[i];
        //ignore namespace definition attributes
        if (attr.name.indexOf("xmlns") === 0) {
          continue;
        }
        attrListToRender.push(attr);
      }
    }

    attrListToRender.sort(this.attrCompare);

    for (attr of attrListToRender) {
      res.push(" ", attr.name, '="', utils.encodeSpecialCharactersInAttribute(attr.value), '"');
    }

    return res.join("");
  }

  /**
   * Create the string of all namespace declarations that should appear on this element
   *
   * @param {Node} node. The node we now render
   * @param {Array} prefixesInScope. The prefixes defined on this node
   *                parents which are a part of the output set
   * @param {String} defaultNs. The current default namespace
   * @return {String}
   * @api private
   */
  renderNs(node, prefixesInScope, defaultNs, defaultNsForPrefix, inclusiveNamespacesPrefixList) {
    let i;
    let attr;
    const res = [];
    let newDefaultNs = defaultNs;
    const nsListToRender = [];
    const currNs = node.namespaceURI || "";

    //handle the namespaceof the node itself
    if (node.prefix) {
      if (
        !isPrefixInScope(
          prefixesInScope,
          node.prefix,
          node.namespaceURI || defaultNsForPrefix[node.prefix]
        )
      ) {
        nsListToRender.push({
          prefix: node.prefix,
          namespaceURI: node.namespaceURI || defaultNsForPrefix[node.prefix],
        });
        prefixesInScope.push({
          prefix: node.prefix,
          namespaceURI: node.namespaceURI || defaultNsForPrefix[node.prefix],
        });
      }
    } else if (defaultNs !== currNs) {
      //new default ns
      newDefaultNs = node.namespaceURI;
      res.push(' xmlns="', newDefaultNs, '"');
    }

    //handle the attributes namespace
    if (node.attributes) {
      for (i = 0; i < node.attributes.length; ++i) {
        attr = node.attributes[i];

        //handle all prefixed attributes that are included in the prefix list and where
        //the prefix is not defined already
        if (
          attr.prefix &&
          !isPrefixInScope(prefixesInScope, attr.localName, attr.value) &&
          inclusiveNamespacesPrefixList.indexOf(attr.localName) >= 0
        ) {
          nsListToRender.push({ prefix: attr.localName, namespaceURI: attr.value });
          prefixesInScope.push({ prefix: attr.localName, namespaceURI: attr.value });
        }

        //handle all prefixed attributes that are not xmlns definitions and where
        //the prefix is not defined already
        if (
          attr.prefix &&
          !isPrefixInScope(prefixesInScope, attr.prefix, attr.namespaceURI) &&
          attr.prefix !== "xmlns" &&
          attr.prefix !== "xml"
        ) {
          nsListToRender.push({ prefix: attr.prefix, namespaceURI: attr.namespaceURI });
          prefixesInScope.push({ prefix: attr.prefix, namespaceURI: attr.namespaceURI });
        }
      }
    }

    nsListToRender.sort(this.nsCompare);

    //render namespaces
    for (const p of nsListToRender) {
      res.push(" xmlns:", p.prefix, '="', p.namespaceURI, '"');
    }

    return { rendered: res.join(""), newDefaultNs: newDefaultNs };
  }

  processInner(
    node,
    prefixesInScope,
    defaultNs,
    defaultNsForPrefix,
    inclusiveNamespacesPrefixList
  ) {
    if (node.nodeType === 8) {
      return this.renderComment(node);
    }
    if (node.data) {
      return utils.encodeSpecialCharactersInText(node.data);
    }

    let i;
    let pfxCopy;
    const ns = this.renderNs(
      node,
      prefixesInScope,
      defaultNs,
      defaultNsForPrefix,
      inclusiveNamespacesPrefixList
    );
    const res = ["<", node.tagName, ns.rendered, this.renderAttrs(node), ">"];

    for (i = 0; i < node.childNodes.length; ++i) {
      pfxCopy = prefixesInScope.slice(0);
      res.push(
        this.processInner(
          node.childNodes[i],
          pfxCopy,
          ns.newDefaultNs,
          defaultNsForPrefix,
          inclusiveNamespacesPrefixList
        )
      );
    }

    res.push("</", node.tagName, ">");
    return res.join("");
  }

  // Thanks to deoxxa/xml-c14n for comment renderer
  renderComment(node) {
    if (!this.includeComments) {
      return "";
    }

    const isOutsideDocument = node.ownerDocument === node.parentNode;
    let isBeforeDocument = null;
    let isAfterDocument = null;

    if (isOutsideDocument) {
      let nextNode = node;
      let previousNode = node;

      while (nextNode !== null) {
        if (nextNode === node.ownerDocument.documentElement) {
          isBeforeDocument = true;
          break;
        }

        nextNode = nextNode.nextSibling;
      }

      while (previousNode !== null) {
        if (previousNode === node.ownerDocument.documentElement) {
          isAfterDocument = true;
          break;
        }

        previousNode = previousNode.previousSibling;
      }
    }

    return (
      (isAfterDocument ? "\n" : "") +
      "<!--" +
      utils.encodeSpecialCharactersInText(node.data) +
      "-->" +
      (isBeforeDocument ? "\n" : "")
    );
  }

  /**
   * Perform canonicalization of the given node
   *
   * @param {Node} node
   * @return {String}
   * @api public
   */
  process(node, options) {
    options = options || {};
    let inclusiveNamespacesPrefixList = options.inclusiveNamespacesPrefixList || [];
    const defaultNs = options.defaultNs || "";
    const defaultNsForPrefix = options.defaultNsForPrefix || {};
    if (!(inclusiveNamespacesPrefixList instanceof Array)) {
      inclusiveNamespacesPrefixList = inclusiveNamespacesPrefixList.split(" ");
    }

    const ancestorNamespaces = options.ancestorNamespaces || [];

    /**
     * If the inclusiveNamespacesPrefixList has not been explicitly provided then look it up in CanonicalizationMethod/InclusiveNamespaces
     */
    if (inclusiveNamespacesPrefixList.length === 0) {
      const CanonicalizationMethod = utils.findChilds(node, "CanonicalizationMethod");
      if (CanonicalizationMethod.length !== 0) {
        const inclusiveNamespaces = utils.findChilds(
          CanonicalizationMethod[0],
          "InclusiveNamespaces"
        );
        if (inclusiveNamespaces.length !== 0) {
          inclusiveNamespacesPrefixList = inclusiveNamespaces[0]
            .getAttribute("PrefixList")
            .split(" ");
        }
      }
    }

    /**
     * If you have a PrefixList then use it and the ancestors to add the necessary namespaces
     */
    if (inclusiveNamespacesPrefixList) {
      const prefixList =
        inclusiveNamespacesPrefixList instanceof Array
          ? inclusiveNamespacesPrefixList
          : inclusiveNamespacesPrefixList.split(" ");
      prefixList.forEach(function (prefix) {
        if (ancestorNamespaces) {
          ancestorNamespaces.forEach(function (ancestorNamespace) {
            if (prefix === ancestorNamespace.prefix) {
              node.setAttributeNS(
                "http://www.w3.org/2000/xmlns/",
                "xmlns:" + prefix,
                ancestorNamespace.namespaceURI
              );
            }
          });
        }
      });
    }

    const res = this.processInner(
      node,
      [],
      defaultNs,
      defaultNsForPrefix,
      inclusiveNamespacesPrefixList
    );
    return res;
  }

  getAlgorithmName() {
    return "http://www.w3.org/2001/10/xml-exc-c14n#";
  }
}

/**
 * Add c14n#WithComments here (very simple subclass)
 * @type { import("../index.d.ts").CanonicalizationOrTransformationAlgorithm}
 */
class ExclusiveCanonicalizationWithComments extends ExclusiveCanonicalization {
  constructor() {
    super();
    this.includeComments = true;
  }

  getAlgorithmName() {
    return "http://www.w3.org/2001/10/xml-exc-c14n#WithComments";
  }
}

module.exports = {
  ExclusiveCanonicalization,
  ExclusiveCanonicalizationWithComments,
};
