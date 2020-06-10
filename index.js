const suggestions = {};

const addSuggestion = (key, val) => {
    if (val instanceof RegExp) val = val.toString();
    if (!suggestions[key]) {
        suggestions[key] = new Set();
    }
    suggestions[key].add(val);
};

class Parser {
    constructor(parseStateTransformFn) {
        this.parseStateTransformFn = parseStateTransformFn;
    }

    run(target) {
        const initialState = {
            target,
            index: 0,
            result: null,
            isError: false,
            error: null,
            errorChain: [],
            lastMatchedToken: null,
            lastMatchedParserIndex: 0,
            lastMatchedTokenIndex: 0
        };
        return this.parseStateTransformFn(initialState);
    }
    /* map return a new Parser whose result is transformed from previous Parser, 
which can help us sort of seleectively extract structure or employ structure */
    map(fn) {
        return new Parser(parserState => {
            const nextState = this.parseStateTransformFn(parserState);

            if (nextState.isError) return nextState;

            return updateParserResult(nextState, fn(nextState.result));
        });
    }

    errorMap(fn) {
        return new Parser(parserState => {
            const nextState = this.parseStateTransformFn(parserState);

            if (!nextState.isError) return nextState;

            return updateParserError(nextState, fn(nextState.error, nextState.index));
        });
    }
    /* 
chain is similar to a concept called flat map in functional praograming. 
And the flat map apply a function to every element in a array just like map, but then it will flat the old array and new array.
In parser combinators system, chain allows us look back what we just parsed and based our next move on that result
The calling mechanism of chain is similar to promise
*/
    chain(fn) {
        return new Parser(parserState => {
            const nextState = this.parseStateTransformFn(parserState);

            if (nextState.isError) return nextState;

            const nextParser = fn(nextState);
            // the flat step is actually here
            return nextParser.parseStateTransformFn(nextState);
        });
    }
}

const updateParserState = (state, index, result) => {
    return {
        ...state,
        index,
        result
    };
};

const updateParserResult = (state, result) => {
    return {
        ...state,
        result
    };
};

const updateParserError = (state, errMsg) => {
    return {
        ...state,
        isError: true,
        error: errMsg,
        errorChain: state.errorChain.concat(errMsg)
    };
};

const isSeparation = (str, sepRegexs) => {
    for (sep of sepRegexs) {
        if (sep.test(str)) return true;
    }
    return false;
};

const regexParserFactory = (regex, regexType) =>
    new Parser(parserState => {
        const { target, index, isError } = parserState;
        if (isError) {
            return parserState;
        }
        const slicedTarget = target.slice(index);
        const matchedRes = slicedTarget.match(regex);
        if (slicedTarget.length === 0 && !matchedRes) {
            parserState.lastMatchedTokenIndex === parserState.lastMatchedParserIndex
                ? addSuggestion(parserState.lastMatchedToken, regex)
                : addSuggestion(parserState.result, regex);
            return updateParserError(
                parserState,
                `${regexType}: Tried match ${regex} got unexpected input at index ${index}`
            );
        }
        if (matchedRes) {
            return isSeparation(matchedRes[0], [/^\s*$/, /^,$/])
                ? updateParserState(parserState, index + matchedRes[0].length, matchedRes[0])
                : updateParserState(
                      {
                          ...parserState,
                          lastMatchedToken: matchedRes[0],
                          lastMatchedTokenIndex: index + matchedRes[0].length,
                          lastMatchedParserIndex: index + matchedRes[0].length
                      },
                      index + matchedRes[0].length,
                      matchedRes[0]
                  );
        }
        parserState.lastMatchedTokenIndex === parserState.lastMatchedParserIndex
            ? addSuggestion(parserState.lastMatchedToken, regex)
            : addSuggestion(parserState.result, regex);
        return updateParserError(
            parserState,
            `${regexType}: Couldn't match ${regex} at index ${index}, remaining string: ${slicedTarget.slice(
                0,
                20
            )}`
        );
    });

const letters = regexParserFactory(/^[a-zA-Z]+/, "letters");
const digits = regexParserFactory(/^[0-9]+/, "digits");

const str = s =>
    new Parser(parserState => {
        const { target, index, isError } = parserState;
        if (isError) {
            return parserState;
        }
        const slicedTarget = target.slice(index);
        if (slicedTarget.length === 0) {
            parserState.lastMatchedTokenIndex === parserState.lastMatchedParserIndex
                ? addSuggestion(parserState.lastMatchedToken, s)
                : addSuggestion(parserState.result, s);
            return updateParserError(parserState, `Tried to match ${s} but got unexpected input`);
        }
        if (slicedTarget.startsWith(s)) {
            return isSeparation(s, [/^\s*$/, /^,$/])
                ? updateParserState(parserState, index + s.length, s)
                : updateParserState(
                      {
                          ...parserState,
                          lastMatchedToken: s,
                          lastMatchedTokenIndex: index + s.length,
                          lastMatchedParserIndex: index + s.length
                      },
                      index + s.length,
                      s
                  );
        }
        parserState.lastMatchedTokenIndex === parserState.lastMatchedParserIndex
            ? addSuggestion(parserState.lastMatchedToken, s)
            : addSuggestion(parserState.result, s);
        return updateParserError(
            parserState,
            `Tried to match ${s} but got ${target.slice(index, index + 10)}`
        );
    });

const eat = terminal =>
    new Parser(parserState => {
        const { target, index, isError } = parserState;
        if (isError) {
            return parserState;
        }
        const slicedTarget = target.slice(index);
        const matched = slicedTarget.match(terminal);
        const termIndex = matched ? matched.index : -1;
        const eatenToken = slicedTarget.slice(0, termIndex);
        if (termIndex !== -1) {
            return updateParserState(
                {
                    ...parserState,
                    lastMatchedToken: eatenToken,
                    lastMatchedTokenIndex: index + termIndex,
                    lastMatchedParserIndex: index + termIndex
                },
                index + termIndex,
                eatenToken
            );
        }

        return updateParserState(
            {
                ...parserState,
                lastMatchedToken: slicedTarget,
                lastMatchedTokenIndex: target.length,
                lastMatchedParserIndex: target.length
            },
            target.length,
            slicedTarget
        );
    });

const sequenceOf = parsers =>
    new Parser(parserState => {
        if (parserState.isError) {
            return parserState;
        }
        const results = [];
        let nextState = parserState;
        for (let parser of parsers) {
            nextState = parser.parseStateTransformFn(nextState);
            results.push(nextState.result);
        }

        if (nextState.isError) {
            return nextState;
        }
        return updateParserResult(nextState, results);
    });

const choice = parsers =>
    new Parser(parserState => {
        if (parserState.isError) {
            return parserState;
        }
        let lastMatchedToken = null;
        let lastMatchedTokenIndex = 0;
        let preStateMatchedTokenState = 0;
        for (let parser of parsers) {
            const nextState = parser.parseStateTransformFn(parserState);
            if (!nextState.isError) {
                return nextState;
            }
            // 在choice的场景中，lastMatchedToken是走得最远的那个token
            console.log(`choice matching failed, reason:  ${nextState.error}`);
            if (
                nextState.lastMatchedToken &&
                nextState.lastMatchedTokenIndex > preStateMatchedTokenState
            ) {
                lastMatchedToken = nextState.lastMatchedToken;
                preStateMatchedTokenState = lastMatchedTokenIndex = nextState.lastMatchedTokenIndex;
            }
        }
        return updateParserError(
            { ...parserState, lastMatchedToken, lastMatchedTokenIndex },
            `choice: unable to match any parser at index ${parserState.index}`
        );
    });

const many = parser =>
    new Parser(parserState => {
        if (parserState.isError) {
            return parserState;
        }
        const results = [];
        let done = false;
        let nextState = parserState;
        let lastSuccessState = parserState;
        while (!done) {
            nextState = parser.parseStateTransformFn(nextState);
            if (!nextState.isError) {
                results.push(nextState.result);
                lastSuccessState = nextState;
            } else {
                done = true;
            }
        }
        return updateParserResult(
            {
                ...lastSuccessState,
                errorChain: nextState.errorChain,
                lastMatchedToken: nextState.lastMatchedToken,
                lastMatchedTokenIndex: nextState.lastMatchedTokenIndex
            },
            results
        );
    });

const manyOne = parser =>
    new Parser(parserState => {
        if (parserState.isError) {
            return parserState;
        }
        const results = [];
        let done = false;
        let nextState = parserState;
        let lastState = parserState;
        while (!done) {
            lastState = parser.parseStateTransformFn(nextState);
            if (!lastState.isError) {
                results.push(lastState.result);
                nextState = lastState;
            } else {
                done = true;
            }
        }
        if (results.length === 0) {
            return updateParserError(
                {
                    ...parserState,
                    errorChain: lastState.errorChain,
                    lastMatchedToken: lastState.lastMatchedToken,
                    lastMatchedTokenIndex: lastState.lastMatchedTokenIndex
                },
                `manyOne: Unable to match any input using parser at index ${parserState.index}`
            );
        }
        return updateParserResult(
            {
                ...nextState,
                errorChain: lastState.errorChain,
                lastMatchedToken: lastState.lastMatchedToken,
                lastMatchedTokenIndex: lastState.lastMatchedTokenIndex
            },
            results
        );
    });

const between = (leftParser, rightParser) => contentParser => {
    return sequenceOf([leftParser, contentParser, rightParser]).map(results => results[1]);
};

const sepBy = separatorParser => valueParser =>
    new Parser(parserState => {
        if (parserState.isError) {
            return parserState;
        }
        const results = [];
        let nextState = parserState;
        let thingWeWantState;
        while (true) {
            thingWeWantState = valueParser.parseStateTransformFn(nextState);
            if (thingWeWantState.isError) {
                break;
            }
            results.push(thingWeWantState.result);
            nextState = thingWeWantState;
            const separatorState = separatorParser.parseStateTransformFn(nextState);
            if (separatorState.isError) {
                break;
            }
            nextState = separatorState;
        }
        return updateParserResult(
            {
                ...nextState,
                errorChain: thingWeWantState.errorChain,
                lastMatchedToken: thingWeWantState.lastMatchedToken,
                lastMatchedTokenIndex: thingWeWantState.lastMatchedTokenIndex
            },
            results
        );
    });

const sepByOne = separatorParser => valueParser =>
    new Parser(parserState => {
        if (parserState.isError) {
            return parserState;
        }
        const results = [];
        let nextState = parserState;
        let thingWeWantState;
        while (true) {
            thingWeWantState = valueParser.parseStateTransformFn(nextState);
            if (thingWeWantState.isError) {
                break;
            }
            results.push(thingWeWantState.result);
            nextState = thingWeWantState;
            const separatorState = separatorParser.parseStateTransformFn(nextState);
            if (separatorState.isError) {
                break;
            }
            nextState = separatorState;
        }
        if (results.length === 0) {
            return updateParserError(
                {
                    ...parserState,
                    errorChain: thingWeWantState.errorChain,
                    lastMatchedToken: thingWeWantState.lastMatchedToken,
                    lastMatchedTokenIndex: thingWeWantState.lastMatchedTokenIndex
                },
                `sepByOne: Unable to capture any results using parser at index ${parserState.index}`
            );
        }
        return updateParserResult(
            {
                ...nextState,
                errorChain: thingWeWantState.errorChain,
                lastMatchedToken: thingWeWantState.lastMatchedToken,
                lastMatchedTokenIndex: thingWeWantState.lastMatchedTokenIndex
            },
            results
        );
    });
// create a parser with specified result
const succeed = value =>
    new Parser(parserState => {
        if (parserState.isError) {
            return parserState;
        }
        return updateParserResult(parserState, value);
    });
// lazy can be used to process recursed production
const lazy = thunkParser =>
    new Parser(parserState => {
        const parser = thunkParser();
        return parser.parseStateTransformFn(parserState);
    });

const oneOrZero = parser => choice([parser, succeed(null)]);

const caseStr = str => {
    return regexParserFactory(new RegExp(str, "i"), "caseStr");
};

const strictCaseStr = str => {
    return regexParserFactory(new RegExp("^" + str + "$", "i"), "strictCaseStr");
};

const strictStr = str => {
    return regexParserFactory(new RegExp("^" + str + "$"), "strictCaseStr");
};

const sequenceSepBy = sep => parsers =>
    new Parser(parserState => {
        if (parserState.isError) {
            return parserState;
        }
        const results = [];
        let nextState = parserState;
        let count = 0;
        for (; count < parsers.length - 1; count++) {
            nextState = parsers[count].parseStateTransformFn(nextState);
            results.push(nextState.result);
            nextState = sep.parseStateTransformFn(nextState);
        }
        nextState = parsers[count].parseStateTransformFn(nextState);
        results.push(nextState.result);
        if (nextState.isError) {
            return nextState;
        }
        return updateParserResult(nextState, results);
    });

const peek = new Parser(parserState => {
    return updateParserResult(parserState, parserState.target[parserState.index]);
});

const getCurState = new Parser(parserState => parserState);

const setCurState = state =>
    new Parser(parserState => {
        return state;
    });

const contextual = parserGenerator => {
    return succeed(null).chain(() => {
        const gen = parserGenerator();
        const runStep = nextState => {
            const yieldRes = gen.next(nextState);
            if (yieldRes.done) {
                return succeed(yieldRes.value);
            }
            const nextParser = yieldRes.value;
            if (!nextParser instanceof Parser) {
                throw new Error("contextual: yielded values must always be parsers!");
            }
            return nextParser.chain(runStep);
        };
        return runStep();
    });
};

// const varDeclarationParser = choice([str("var "), str("global_var ")])
//     .chain(declarationType => letters)
//     .chain(varName => choice([str(":INT"), str(":CHAR")]).map(varType => [varType, varName]));
function* parserGenerator() {
    const declarationType = yield choice([str("var "), str("global_var ")]);
    const varName = yield letters;
    const varType = yield choice([str(":INT"), str(":CHAR")]);
    return {
        declarationType,
        varName,
        varType
    };
}
// finally, we will have just one parser,which contains all parseStateTransformFn from other parser.
// console.log(
//     sequenceOf([
//         str("1"),
//         str("2"),
//         setCurState({
//             target: "12",
//             index: 0,
//             result: 3,
//             isError: false,
//             error: null,
//             errorChain: [],
//             lastMatchedToken: null,
//             lastMatchedParserIndex: 0,
//             lastMatchedTokenIndex: 0
//         }),
//         str('1')
//     ]).run("12")
// );
// console.log(between(str("("), str(")"))(sequenceOf([space, digits, space]).map(result => result[1])).run("( 123  )"));

module.exports = {
    Parser,
    updateParserState,
    updateParserResult,
    updateParserError,
    regexParserFactory,
    letters,
    digits,
    str,
    sequenceOf,
    choice,
    many,
    manyOne,
    between,
    sepBy,
    sepByOne,
    succeed,
    lazy,
    contextual,
    oneOrZero,
    caseStr,
    strictCaseStr,
    strictStr,
    sequenceSepBy,
    suggestions,
    eat,
    getCurState,
    setCurState,
    peek
};
