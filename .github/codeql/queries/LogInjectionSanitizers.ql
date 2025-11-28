/**
 * @name Log injection with custom sanitizers
 * @description Override the default log injection query to recognize our custom sanitizer functions.
 * @kind path-problem
 * @problem.severity warning
 * @security-severity 7.8
 * @precision medium
 * @id js/log-injection-custom
 * @tags security
 *       external/cwe/cwe-117
 */

import javascript
import semmle.javascript.security.dataflow.LogInjectionQuery
import LogInjectionFlow::PathGraph

/**
 * A call to one of our custom sanitizer functions that prevents log injection.
 * These functions remove newlines, ANSI codes, and control characters from strings.
 */
class CustomLogSanitizer extends Sanitizer {
  CustomLogSanitizer() {
    // Match calls to sanitizeForLog, sanitizeObjectForLog, sanitizeConfigForLogging
    exists(DataFlow::CallNode call |
      call.getCalleeName() = ["sanitizeForLog", "sanitizeObjectForLog", "sanitizeConfigForLogging"] and
      this = call
    )
  }
}

from LogInjectionFlow::PathNode source, LogInjectionFlow::PathNode sink
where LogInjectionFlow::flowPath(source, sink)
select sink.getNode(), source, sink, "Log entry depends on a $@.", source.getNode(),
  "user-provided value"
