import java.nio.file.*;
import java.util.*;
import org.jetbrains.kotlin.cli.jvm.compiler.*;
import org.jetbrains.kotlin.config.CompilerConfiguration;
import org.jetbrains.kotlin.psi.KtPsiFactory;
import org.jetbrains.kotlin.com.intellij.openapi.util.Disposer;
import org.jetbrains.kotlin.com.intellij.psi.PsiErrorElement;
import org.jetbrains.kotlin.com.intellij.psi.util.PsiTreeUtil;
class CheckKotlinSyntax {
 public static void main(String[] args) throws Exception {
  var disposable = Disposer.newDisposable(); int errors = 0;
  try {
   var env = KotlinCoreEnvironment.createForProduction(disposable, new CompilerConfiguration(), EnvironmentConfigFiles.JVM_CONFIG_FILES);
   var factory = new KtPsiFactory(env.getProject(), false);
   for (var arg : args) {
    var path = Path.of(arg); var source = Files.readString(path).replace("\r\n", "\n").replace("\r", "\n");
    var file = factory.createFile(path.getFileName().toString(), source);
    for (var error : PsiTreeUtil.collectElementsOfType(file, PsiErrorElement.class)) {
     int line = 1 + (int)source.substring(0, error.getTextOffset()).chars().filter(c -> c == '\n').count();
     System.out.println(path + ":" + line + ": " + error.getErrorDescription()); errors++;
    }
   }
   System.out.println("Kotlin PSI: " + args.length + " files, " + errors + " syntax errors. No Android compilation performed.");
  } finally { Disposer.dispose(disposable); }
  if(errors > 0) System.exit(1);
 }
}

