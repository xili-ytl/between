package com.privatechat.couplechat

import android.content.Context
import androidx.room.Room
import com.privatechat.couplechat.core.push.PushProvider
import java.io.File
import com.privatechat.couplechat.core.push.PushRegistrationCoordinator
import com.privatechat.couplechat.core.avatar.AvatarProcessor
import com.privatechat.couplechat.core.data.AuthRepository
import com.privatechat.couplechat.core.image.ImageLocalCache
import com.privatechat.couplechat.core.image.GallerySaver
import com.privatechat.couplechat.core.image.ImageMessageProcessor
import com.privatechat.couplechat.core.data.ChatRepository
import com.privatechat.couplechat.core.diagnostics.LogWenliTimingSink
import com.privatechat.couplechat.core.diagnostics.NoOpWenliTimingSink
import com.privatechat.couplechat.core.data.ChatSearchRepository
import com.privatechat.couplechat.core.data.ReadStateRepository
import com.privatechat.couplechat.core.data.SharedPrefsCacheVersionStore
import com.privatechat.couplechat.core.data.SharedPrefsSyncCursorStore
import com.privatechat.couplechat.core.data.MomentsRepository
import com.privatechat.couplechat.core.data.ProfileRepository
import com.privatechat.couplechat.core.data.RemarkRepository
import com.privatechat.couplechat.core.data.SharedPreferencesProfileCacheStore
import com.privatechat.couplechat.core.database.AppDatabase
import com.privatechat.couplechat.core.database.RoomMessageLocalStore
import com.privatechat.couplechat.core.database.RoomRemarkLocalStore
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.CloudBaseChatApi
import com.privatechat.couplechat.core.sync.AdaptiveSyncPolicy
import com.privatechat.couplechat.core.sync.MutableMessageArrivalSignal
import com.privatechat.couplechat.core.session.EncryptedSessionStore
import com.privatechat.couplechat.core.session.SessionManager
import com.privatechat.couplechat.core.push.ChatApiPushRegistrationGateway
import com.privatechat.couplechat.core.push.AppForegroundState
import com.privatechat.couplechat.core.push.PushRegistrationTask
import com.privatechat.couplechat.core.push.SharedPreferencesPushTokenStore
import com.privatechat.couplechat.core.push.WorkManagerPushWorkScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import com.privatechat.couplechat.core.update.AndroidUpdatePlatform
import com.privatechat.couplechat.core.update.ApkPackageVerifier
import com.privatechat.couplechat.core.update.AppUpdaterDownloadEngine
import com.privatechat.couplechat.core.update.UpdateRepository

class AppContainer(
    context: Context,
    pushProvider: PushProvider,
) {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val sessions = SessionManager(EncryptedSessionStore(context))
    val api = CloudBaseChatApi(
        endpoint = BuildConfig.CLOUDBASE_FUNCTION_URL,
        publishableKey = BuildConfig.CLOUDBASE_PUBLISHABLE_KEY,
    )
    val pushTokens = SharedPreferencesPushTokenStore(context)
    /** 推送自定义消息到达时唤醒前台同步，避免等到下一次轮询（最长 15 秒）。 */
    val messageArrivals = MutableMessageArrivalSignal()
    /** 聊天页真实可见时抑制该会话通知；状态通过文件与进程前台检查跨 :pushcore 读取。 */
    val appForeground = AppForegroundState(context)
   val pushGateway = ChatApiPushRegistrationGateway(api)
   val pushRegistrationTask = PushRegistrationTask(sessions, pushTokens, pushGateway)
   private val pushScheduler = WorkManagerPushWorkScheduler(context)
   val pushRegistration = PushRegistrationCoordinator(
        sessions = sessions,
        tokens = pushTokens,
        provider = pushProvider,
        scheduler = pushScheduler,
       gateway = pushGateway,
       scope = applicationScope,
   ).also(PushRegistrationCoordinator::start)
    private val database = Room.databaseBuilder(
        context,
        AppDatabase::class.java,
        "private-chat.db",
    ).addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4).build()

    val auth = AuthRepository(api, sessions, pushRegistration)
    private val messageLocal = RoomMessageLocalStore(database.messageDao())
    val readStates = ReadStateRepository(
        api = api,
        sessions = sessions,
        context = context,
        onServerConfirmedRead = appForeground::recordServerConfirmedRead,
    )
    private val imageLocalCache = ImageLocalCache(File(context.filesDir, "images"))
    private val wenliTiming = if (BuildConfig.WENLI_TIMING_ENABLED) LogWenliTimingSink() else NoOpWenliTimingSink
    val chat = ChatRepository(
        api = api,
        local = messageLocal,
        sessions = sessions,
        policy = AdaptiveSyncPolicy(),
        versionStore = SharedPrefsCacheVersionStore(context),
        readStates = readStates,
        imageCache = imageLocalCache,
        cursorStore = SharedPrefsSyncCursorStore(context),
        arrivals = messageArrivals,
        wenliTiming = wenliTiming,
    )
    val chatSearch = ChatSearchRepository(messageLocal)
    fun moments(session: Session) = MomentsRepository(api, sessions, session)
    val profileCache = SharedPreferencesProfileCacheStore(context)
    val profiles = ProfileRepository(api, sessions, auth, profileCache)
    val remarks = RemarkRepository(api, RoomRemarkLocalStore(database.remarkDao()), sessions)
    val avatars = AvatarProcessor(context)
    val imageProcessor = ImageMessageProcessor(context)
    val gallerySaver = GallerySaver(context)
    val updatePlatform = AndroidUpdatePlatform(context)
    val updates = UpdateRepository(
        api = api,
        downloader = AppUpdaterDownloadEngine(context),
        verifier = ApkPackageVerifier(
            current = updatePlatform.currentIdentity,
            reader = updatePlatform.candidateReader,
        ),
        currentVersionCode = BuildConfig.VERSION_CODE,
    )
}
