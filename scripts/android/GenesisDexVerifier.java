import dalvik.system.PathClassLoader;

/** Initializes only stateless Kotlin screen holders, without an account or application data. */
public final class GenesisDexVerifier {
    public static void main(String[] args) {
        ClassLoader loader = new PathClassLoader(args[0], ClassLoader.getSystemClassLoader());
        int failures = 0;
        for (int index = 1; index < args.length; index++) {
            try {
                // false only loads metadata and misses ART's bytecode verification failure.
                Class.forName(args[index], true, loader);
                System.out.println("VERIFIED " + args[index]);
            } catch (Throwable error) {
                failures++;
                System.err.println("REJECTED " + args[index] + " " + error);
            }
        }
        if (failures != 0) System.exit(1);
    }
}
