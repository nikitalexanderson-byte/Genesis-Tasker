package ru.genesis.calendar.data

import android.content.Context
import android.util.JsonReader
import android.util.JsonToken
import org.json.JSONObject
import java.io.File
import java.io.Reader
import java.util.UUID

/** skipValue streams the large state instead of constructing JSONObject trees.
 * The original state, including duplicate names, reaches the shared strict
 * source parser later. This bounded header check grants no restore authority. */
internal object NativeBackupFormMetadata {
    fun read(source:Reader):JSONObject=JsonReader(source).use { reader->
        reader.isLenient=false
        val result=JSONObject();val seen=mutableSetOf<String>()
        reader.beginObject()
        while(reader.hasNext()){
            val name=reader.nextName();check(seen.add(name)){"E2EE_ARCHIVE_SOURCE_INVALID"}
            when(name){
                "protocol"->{check(reader.peek()==JsonToken.NUMBER&&reader.nextString()=="1"){"E2EE_ARCHIVE_SOURCE_INVALID"};result.put(name,1)}
                "state"->{check(reader.peek()==JsonToken.BEGIN_OBJECT){"E2EE_ARCHIVE_SOURCE_INVALID"};reader.skipValue()}
                "settled"->{check(reader.peek()==JsonToken.BOOLEAN){"E2EE_ARCHIVE_SOURCE_INVALID"};result.put(name,reader.nextBoolean())}
                "file"->{
                    if(reader.peek()==JsonToken.NULL){reader.nextNull();result.put(name,JSONObject.NULL)}else{
                        val file=JSONObject();val fields=mutableSetOf<String>();reader.beginObject()
                        while(reader.hasNext()){
                            val field=reader.nextName();check(fields.add(field)){"E2EE_ARCHIVE_SOURCE_INVALID"}
                            when(field){
                                "id","name","type"->{check(reader.peek()==JsonToken.STRING){"E2EE_ARCHIVE_SOURCE_INVALID"};val value=reader.nextString();check(value.length<=if(field=="type")1024 else 4096){"E2EE_ARCHIVE_SOURCE_INVALID"};file.put(field,value)}
                                "size","lastModified"->{check(reader.peek()==JsonToken.NUMBER){"E2EE_ARCHIVE_SOURCE_INVALID"};val value=reader.nextString();check(value.matches(Regex("-?(?:0|[1-9][0-9]{0,15})"))){"E2EE_ARCHIVE_SOURCE_INVALID"};val number=value.toLong();check(number in -9007199254740991L..9007199254740991L){"E2EE_ARCHIVE_SOURCE_INVALID"};file.put(field,number)}
                                else->error("E2EE_ARCHIVE_SOURCE_INVALID")
                            }
                        }
                        reader.endObject();check(fields==setOf("id","name","type","size","lastModified")){"E2EE_ARCHIVE_SOURCE_INVALID"};result.put(name,file)
                    }
                }
                else->error("E2EE_ARCHIVE_SOURCE_INVALID")
            }
        }
        reader.endObject();check(seen==setOf("protocol","state","settled","file")&&reader.peek()==JsonToken.END_DOCUMENT){"E2EE_ARCHIVE_SOURCE_INVALID"}
        result
    }
}

/** Small manifest only. Unlike JSONObject's duplicate projection, this check
 * rejects duplicate names before accepting any new field/file reference. */
internal object NativeBackupValueManifest {
    fun read(raw:String):JSONObject {
        check(raw.length in 1..32768){"E2EE_ARCHIVE_SOURCE_INVALID"}
        return JsonReader(java.io.StringReader(raw)).use{reader->
            reader.isLenient=false;var count=0
            fun value(depth:Int):Any {
                check(depth<=8&&++count<=1000){"E2EE_ARCHIVE_SOURCE_INVALID"}
                return when(reader.peek()){
                    JsonToken.BEGIN_OBJECT->{
                        val result=JSONObject();val seen=mutableSetOf<String>();reader.beginObject()
                        while(reader.hasNext()){val name=reader.nextName();check(seen.add(name)){"E2EE_ARCHIVE_SOURCE_INVALID"};result.put(name,value(depth+1))}
                        reader.endObject();result
                    }
                    JsonToken.BEGIN_ARRAY->{
                        val result=org.json.JSONArray();reader.beginArray()
                        while(reader.hasNext()){check(result.length()<64){"E2EE_ARCHIVE_SOURCE_INVALID"};result.put(value(depth+1))}
                        reader.endArray();result
                    }
                    JsonToken.STRING->reader.nextString()
                    JsonToken.BOOLEAN->reader.nextBoolean()
                    JsonToken.NULL->{reader.nextNull();JSONObject.NULL}
                    JsonToken.NUMBER->{val text=reader.nextString();check(text.matches(Regex("-?(?:0|[1-9][0-9]{0,15})"))){"E2EE_ARCHIVE_SOURCE_INVALID"}
                        val number=text.toLong();check(number in -9007199254740991L..9007199254740991L){"E2EE_ARCHIVE_SOURCE_INVALID"}
                        if(number in Int.MIN_VALUE..Int.MAX_VALUE)number.toInt()else number}
                    else->error("E2EE_ARCHIVE_SOURCE_INVALID")
                }
            }
            val result=value(0);check(result is JSONObject&&reader.peek()==JsonToken.END_DOCUMENT){"E2EE_ARCHIVE_SOURCE_INVALID"};result
        }
    }
}

private val nativeBackupSpillQuotaMonitor=Any()
internal fun nativeBackupFormSpool(context:Context,maximum:Int=96*1024*1024):BackupFormSpool {
    val cipher=LocalCipher()
    // A session owns this exact directory. Account clear removes only its own
    // referenced frames. Process-death remnants stay encrypted, for the future
    // complete archive collector; never sweep another session's candidates.
    val parent=File(context.noBackupFilesDir,"backup-forms-v1")
    val root=File(parent,UUID.randomUUID().toString())
    fun otherBytes():Long {
        check(!java.nio.file.Files.isSymbolicLink(parent.toPath())){"BACKUP_FORM_STORAGE"}
        val folders=parent.listFiles()?:return 0L
        check(folders.size<=1000){"BACKUP_FORM_QUOTA"}
        return folders.filter{it.name!=root.name}.sumOf{folder->
            check(folder.name.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))&&folder.isDirectory&&
                !java.nio.file.Files.isSymbolicLink(folder.toPath())&&folder.canonicalFile.parentFile==parent.canonicalFile){"BACKUP_FORM_STORAGE"}
            val files=folder.listFiles()?:error("BACKUP_FORM_STORAGE");check(files.size<=30000){"BACKUP_FORM_QUOTA"}
            files.sumOf{file->check(file.isFile&&!java.nio.file.Files.isSymbolicLink(file.toPath())&&file.canonicalFile.parentFile==folder.canonicalFile){"BACKUP_FORM_STORAGE"};file.length()}
        }
    }
    return BackupFormSpool(root,object:BackupFormSpool.Crypto{
        override fun seal(value:String,aad:String)=cipher.encrypt(value,aad)
        override fun open(value:String,aad:String)=cipher.decrypt(value,aad)
    },NativeBackupFormMetadata::read,maximum=maximum,otherBytes=::otherBytes,quotaMonitor=nativeBackupSpillQuotaMonitor)
}
