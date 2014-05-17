var _clfResult = null;
var _xmlutil = new XMLUtils();
var _docElement = null;
var _clfJSON = null;

function initHighlight(jsonText, jsonObj, docElement, sidebarElement, nameTerms, nameRelations) {
	var docElm = id2elm(docElement);
	while (docElm.firstChild != null)
		docElm.removeChild(docElm.firstChild);
	// wzTooltip
	if (clf_wzTooltip) tt_Init();
	try {
		_clfJSON = new CLFJSON(jsonText, jsonObj);
		enhanceDocument(jsonObj);
		_clfResult = showDocument(_clfJSON, docElm);
		fixResult();
		_clfResult.sort();
	} catch (exc) {
		var errmsg = "Unsupported Document";
		if (exc.message.indexOf("CLFERROR: ") == 0)
			errmsg = exc.message.substr(10);
		var strings = errmsg.split("\n");
		docElm.appendChild(document.createTextNode(strings[0]));
		for (var i=1; i < strings.length; i++) {
			docElm.appendChild(document.createElement("BR"));
			docElm.appendChild(document.createTextNode(strings[i]));
		}
	}
}

function id2elm(idorelm) {
    if (typeof idorelm == "string")
    	idorelm = document.getElementById(idorelm);
    return idorelm;
}

// Add Frames information inside Document fragment
function enhanceDocument(jsonObj) {
	var _jsonObj = jsonObj;
	var frameElements = [];
	function clfFrameElement(type, id, name, attrs, offset, length) {
		this.type = type; // 1->Begin, 2->End
		this.id = id;
		this.name = name; // can be null if type = 2 (End)
		this.attrs = attrs; // can be null if type = 2 (End)
		this.offset = offset;
		this.length = length;
	}
	function addToFrameElementsList(frameID, name, attrs, offset, len) {
		frameElements.push(new clfFrameElement(2, frameID, null, null, offset + len, len))
		frameElements.push(new clfFrameElement(1, frameID, name, attrs, offset, len))
	}
	function sortFrames() {
		function sortByOffsetDesc(a, b) {
			// arrange the open & close with minimum overlapping
			if (a.offset != b.offset)
				return b.offset - a.offset;
			if (a.type != b.type)
				return a.type - b.type;
			if (a.length != b.length)
				return (a.type == 1)?a.length - b.length:b.length - a.length;
			if (a.id != b.id)
				return (a.type == 1)?a.id - b.id:b.id - a.id;
			return 0;
		}
		frameElements.sort(sortByOffsetDesc);
	}
	function addFramesToDocument() {
		var documentString = _clfJSON.getDocumentSTR();
		var insertionStr = "";
		for(var s=0; s < frameElements.length; s++) {
			var frameElm = frameElements[s];
			// check if legal offset (not in attribute)
			if (documentString.substring(documentString.lastIndexOf('>', frameElm.offset), frameElm.offset).lastIndexOf('<') >= 0)
				continue;
			if (frameElm.id < 0) {
				if (frameElm.type == 1)
					insertionStr = '<clfBTH id="' + frameElm.id + '"/>';
				else
					insertionStr = '<clfETH id="' + frameElm.id + '"/>';
			} else {
				if (frameElm.type == 1)
					insertionStr = _xmlutil.createclfBHNode(frameElm.id, frameElm.name, frameElm.attrs);
				else
					insertionStr = '<clfEH id="' + frameElm.id + '"/>';
			}
			documentString = documentString.insert(insertionStr, frameElm.offset);
		}
		_clfJSON.setDocumentSTR(documentString);
	}
	clfjsonparserAddFrames(_clfJSON, addToFrameElementsList);
	sortFrames();
	addFramesToDocument(frameElements);
}

// Show the Document fragment inside the htmlElement
function showDocument(clfJSON, htmlElement) {
	// Object to store document element information
	function documentElement(type, content, level) {
		this.type = type; // 1->Header, 3->Text, 101->Highlight
		this.content = content;
		this.level = level;
	}
	// Recursive function that traverse the DOM tree
	function findNodes(xmlNode, level, writer, headersRegexp, skip, result) {
		// Loop through all the children of xmlNode
		for(var m = xmlNode.firstChild; m != null; m = m.nextSibling) {
		    // TEXT_NODE
		    if (m.nodeType == 3) {
				if (m.data != null && !skip /*&& m.data.trim().length > 0*/) {
					writer.addTextElement(level);
					writer.appendStr(m.data);
				}
				continue;
		    }
		    // ELEMENT_NODE
			if (m.nodeType == 1) {
				var id = m.getAttribute("id");
				if (m.tagName == "clfBH") {
					if (!skip) {
						var category = m.getAttribute("category");
						var clfAttrs = new CLFFrameAttributes(category, m.attributes);
						writer.beginHighlight(level, id, category, clfAttrs.isTerm(), clfAttrs.getTooltip());
						result.addResult(category, clfAttrs.getName(), id, clfAttrs.isTerm());
					}
					continue;
				}
				if (m.tagName == "clfEH") {
					if (!skip)
						writer.endHighlight(level, id);
					continue;
				}
				if (m.tagName == "clfBTH") {
					if (!skip)
						writer.beginHighlight(level, id, "TermInsideFrame", null, null);
					continue;
				}
				if (m.tagName == "clfETH") {
					if (!skip)
						writer.endHighlight(level, id);
					continue;
				}
				var nextLevel = level;
				var nlskip = skip;
				if (m.tagName.search(/(p|br)\b/i) == 0) {
					if (!skip)
						writer.addP();
				} else {
					// skip logic
					nlskip = !headersRegexp.test(m.nodeName.toLowerCase()) && skip;
					if (!nlskip) {
						writer.addHeaderElement(level, m.nodeName);
						nextLevel++;
					}
				}
				findNodes(m, nextLevel, writer, headersRegexp, nlskip, result);
			}
		}
	}

	var htmlDoc = document.createElement("div");
	htmlDoc.id = "CLFDOCRoot";
    htmlElement.appendChild(htmlDoc);

	var writer = new CLFDOCWriter(htmlDoc);
	var result = new ExtractionResults();
	var documentFragment = clfJSON.getDocumentNode();
	// Bulid regexp for headers
	var headersRegexp = new RegExp(".*");
	// skip empty nodes
	while (documentFragment.childNodes.length == 0)
		documentFragment = documentFragment.nextSibling;

	// go to the first meaningful root
	while (documentFragment.childNodes.length == 1)
		documentFragment = documentFragment.firstChild;

	// R3.1 compatibility fix - childNodes can hold one of these:
	//	Title, Date and Body
	//	Date and Body
	//	Body
	var foundBody = false;
	for (var childIndex = 0; 
		childIndex < documentFragment.childNodes.length;
		childIndex++)
	{
		var childName = documentFragment.childNodes[childIndex].nodeName;
		if (childName.toLowerCase() == 'body')
		{
			foundBody = true;
			documentFragment = documentFragment.childNodes[childIndex];
		}
	}

	if (foundBody == false)
	{
		return null;
	}

	findNodes(documentFragment, 0, writer, headersRegexp, false, result);

	writer.eod();
    _docElement = htmlDoc;
	return result;
}

// Patch to make the result case insensitive
function fixResult() {
	for (var i=0; i < _clfResult.getCategs().length; i++) {
		var categName = _clfResult.getCategs()[i];
		var allTerms = _clfResult.getCategTerms(categName);
		var hashtbl = new Object();
		var todelete = new Array();
		for (var j=0; j < allTerms.length; j++)
			if (hashtbl[allTerms[j].toLowerCase()] == null)
				hashtbl[allTerms[j].toLowerCase()] = allTerms[j];
			else
				todelete.push(allTerms[j]);
		for (var j=0; j < todelete.length; j++)  {
			_clfResult.unifiedTerms(categName, todelete[j], categName, hashtbl[todelete[j].toLowerCase()]);
			_clfResult.deleteTerm(categName, todelete[j]);
		}
	}
}

// change highlight all
function changeHighlightAll(turnON) {
	for (var i = 0; i < _clfResult.getCategs().length; i++)
		changeHighlight(turnON, i, -1);
}

// change highlight by terms/relations
function changeHighlightByTerm(turnON, onlyTerms) {
	for (var i = 0; i < _clfResult.getCategs().length; i++)
		if (_clfResult.isTerm(_clfResult.getCategs()[i]) == onlyTerms)
			changeHighlight(turnON, i, -1);
}

// change highlight by categ and instance
function changeHighlight(turnON, categID ,instanceID) {
	var categName = _clfResult.getCategs()[categID];
	var from = instanceID;
	var to = instanceID + 1;
	if (instanceID < 0) { // all the category
		from = 0;
		to = _clfResult.getCategTerms(categName).length;
	}
	for (var i = from; i < to; i++) {
		var termName = _clfResult.getCategTerms(categName)[i];
		for (var j = 0; j < _clfResult[categName][termName].length; j++)
			changeSingleHighlight(_clfResult[categName][termName][j], turnON);
	}
}

function changeSingleHighlight(frameID, turnON) {
	var id = frameID;
	frameID = "CLFH" + frameID + ".";
	for (var j=0; j<9; j++) {
		var clfid = frameID + j
		var elm = document.getElementById(clfid);
		if (elm == null)
			break;
		if (turnON) {
// IE7 do not support css2
//				if (! RegExp('\\b' + 'CLFHighlight' + '\\b').test(elm.className))
//					elm.className += elm.className?' '+className:className;
			if (elm.className.indexOf('CLFHighlight') < 0) {
				elm.className += 'CLFHighlight';
				if (_clfResult.isTermID(id))
					elm.className += ' CLFAnyTermHighlight';
				else
					elm.className += ' CLFAnyEventHighlight';
			}
			// tootltip
			if (clf_wzTooltip)
				elm.onmouseover = clfShowTip;
			else
				elm.title = elm.getAttribute("clftooltip");
		} else {
// IE7 do not support css2
//				var rep = elm.className.match(' CLFHighlight')?' '+className:className;
//				elm.className = elm.className.replace(rep, '');
			elm.className = elm.className.replace('CLFHighlight', '');
			if (_clfResult.isTermID(id))
				elm.className = elm.className.replace(' CLFAnyTermHighlight', '');
			else
				elm.className = elm.className.replace(' CLFAnyEventHighlight', '');
			// tootltip
			if (clf_wzTooltip)
				elm.onmouseover = null;
			else
				elm.removeAttribute('title');
		}
	}
	changeTermInsideFrameHighlight(id, turnON);
}

function clfShowTip(e) {
	var elm = this;
	var delim = "<BR><BR>";
	var txt = new StringBuilder();
	while (elm && (elm.tagName == "SPAN" || elm.tagName == "A")) {
		if (elm.attributes && elm.attributes.clftooltip)
			if (elm.className.indexOf('CLFAnyTermHighlight') * elm.className.indexOf('CLFAnyEventHighlight') < 1 ) {
				addTooltipAsHTML(txt, elm.attributes.clftooltip.value)
				txt.Append(delim);
			}
		elm = elm.parentNode;
	}
	txt = txt.ToString();
	Tip(txt.substring(0, txt.length - delim.length));
	// cancel bubbling
	if (!e)
		var e = window.event;
	e.cancelBubble = true;
	if (e.stopPropagation)
		e.stopPropagation();
}

function addTooltipAsHTML(buffer, tooltip) {
	if (tooltip.indexOf('\n') > -1) {
		var lines = tooltip.split('\n');
		buffer.Append("<b>");
		buffer.Append(lines[0]);
		buffer.Append("</b>");
		buffer.Append("<br>");
		for (var i=1; i<lines.length; i++) {
			buffer.Append(lines[i]);
			buffer.Append("<br>");
		}
		return;
	}
	if (tooltip.indexOf('::') > -1) {
		buffer.Append("<b>");
		buffer.Append(tooltip.replace(" :: ",":</b> "));
		buffer.Append("<br>");
		return;
	}
	buffer.Append(tooltip);
}

function changeTermInsideFrameHighlight(frameID, turnON) {
	if (_clfResult.isTermID(frameID))
		return;
	var termID = frameID * -1;
	termID = "CLFH" + termID + ".";
	for (var j=0; j<9; j++) {
		var clfid = termID + j
		var elm = document.getElementById(clfid);
		if (elm == null)
			break;
		if (turnON) {
			if (elm.className.indexOf('CLFHighlight') < 0)
				elm.className += 'CLFHighlight';
		} else {
			elm.className = elm.className.replace('CLFHighlight', '');
		}
	}
}

function toggleInstancesVisibility(categID) {
	var insDiv = document.getElementById("CLFSBInstances" + categID);
	var insImg = document.getElementById("toggleVisibilityImage" + categID);
	if (insDiv.style.display == "none") {
		insDiv.style.display = "block";
		insImg.src = _imagePath + "/collapsesmall.gif";
	} else {
		insDiv.style.display = "none";
		insImg.src = _imagePath + "/expandsmall.gif";
	}
}

function collapseExpandAll(collapse) {
	var i = 0;
	while (true) {
		var insDiv = document.getElementById("CLFSBInstances" + i);
		var insImg = document.getElementById("toggleVisibilityImage" + i);
		if (insDiv == null)
			break;
		if (collapse) {
			insDiv.style.display = "none";
			insImg.src = _imagePath + "/expandsmall.gif";
		} else {
			insDiv.style.display = "block";
			insImg.src = _imagePath + "/collapsesmall.gif";
		}
		i++;
	}
}

