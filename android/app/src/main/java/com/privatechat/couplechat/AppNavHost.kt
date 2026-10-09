package com.privatechat.couplechat

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.compose.ui.platform.testTag
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.privatechat.couplechat.core.model.MomentVisibility
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.session.SessionRestoreCoordinator
import com.privatechat.couplechat.core.session.SessionRestoreState
import com.privatechat.couplechat.feature.chat.ChatScreen
import com.privatechat.couplechat.feature.chat.ChatState
import com.privatechat.couplechat.feature.chat.ChatViewModel
import com.privatechat.couplechat.feature.chat.search.ChatDateScreen
import com.privatechat.couplechat.feature.chat.search.ChatSearchScreen
import com.privatechat.couplechat.feature.chat.search.ChatSearchState
import com.privatechat.couplechat.feature.chat.search.ChatSearchViewModel
import com.privatechat.couplechat.feature.contacts.ChatInfoScreen
import com.privatechat.couplechat.feature.contacts.ContactDetailScreen
import com.privatechat.couplechat.feature.contacts.RemarkEditScreen
import com.privatechat.couplechat.feature.contacts.RemarkState
import com.privatechat.couplechat.feature.contacts.RemarkViewModel
import com.privatechat.couplechat.feature.home.HomeScreen
import com.privatechat.couplechat.feature.login.LoginScreen
import com.privatechat.couplechat.feature.login.LoginViewModel
import com.privatechat.couplechat.feature.me.DisplayNameEditScreen
import com.privatechat.couplechat.feature.me.ProfileEditScreen
import com.privatechat.couplechat.feature.moments.MomentComposerScreen
import com.privatechat.couplechat.feature.moments.MomentsScreen
import com.privatechat.couplechat.feature.moments.MomentsState
import com.privatechat.couplechat.feature.moments.MomentsViewModel
import com.privatechat.couplechat.feature.settings.PasswordEditScreen
import com.privatechat.couplechat.feature.settings.AboutScreen
import com.privatechat.couplechat.feature.settings.SettingsScreen
import com.privatechat.couplechat.feature.settings.SettingsState
import com.privatechat.couplechat.feature.settings.SettingsViewModel
import com.privatechat.couplechat.feature.update.UpdateState
import com.privatechat.couplechat.feature.update.UpdateViewModel
import com.privatechat.couplechat.ui.betweenTextButtonColors
import com.privatechat.couplechat.ui.BetweenEntryScreen
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds

internal object Routes {
    const val HOME = "home"
    const val CHAT = "chat"
    const val CHAT_INFO = "chat-info"
    const val PARTNER_PROFILE = "partner-profile"
    const val CHAT_SEARCH = "chat-search"
    const val CHAT_DATE = "chat-date"
    const val REMARK = "remark"
    const val MOMENTS = "moments"
    const val MOMENTS_OF = "moments-of"
    const val MOMENT_COMPOSE = "moment-compose"
    const val PROFILE = "profile"
    const val PROFILE_NAME = "profile-name"
    const val SETTINGS = "settings"
    const val ABOUT = "about"
    const val PASSWORD = "password"
}

internal const val SIGNED_IN_START_DESTINATION = Routes.HOME
internal val PROFILE_REFRESH_INTERVAL = 15.seconds

internal fun Session.screenStateKey(screen: String): String =
    "$screen|$accountId|$sessionVersion|$token"

@Composable
fun AppNavHost(
    container: AppContainer,
    openChatRequested: Boolean = false,
    onOpenChatRequestConsumed: () -> Unit = {},
) {
    val signedInViewModels: SignedInSessionViewModelHolder = viewModel()
    val loaded by container.sessions.loaded.collectAsState()
    val session by container.sessions.session.collectAsState()
    val restoreScope = rememberCoroutineScope()
    val restoreCoordinator = remember(container, session) {
        SessionRestoreCoordinator(
            scope = restoreScope,
            alreadyLoaded = { container.sessions.loaded.value },
            restore = { container.sessions.load() },
            prepare = {
                container.sessions.current()?.let { container.profiles.prepareForEntry(it) }
            },
        )
    }
    val restoreState by restoreCoordinator.state.collectAsState()
    LaunchedEffect(restoreCoordinator) { restoreCoordinator.start() }
    DisposableEffect(restoreCoordinator) { onDispose { restoreCoordinator.cancel() } }

    val sessionOwner = if (loaded) signedInViewModels.ownerFor(session) else null

    if (!loaded || restoreState !is SessionRestoreState.Ready) {
        BetweenEntryScreen(
            restoreFailed = restoreState is SessionRestoreState.Failed,
            onRetry = restoreCoordinator::retry,
        )
        return
    }

    if (session == null) {
        val login: LoginViewModel = simpleViewModel("login") { LoginViewModel(container.auth) }
        val state by login.state.collectAsState()
        LoginScreen(
            state = state,
            onAccountChanged = login::setAccountId,
            onPasswordChanged = login::setPassword,
            onSubmit = login::submit,
        )
        return
    }

    val active = requireNotNull(session)
    val activeOwner = requireNotNull(sessionOwner)
    key(active.screenStateKey("signed-in")) {
        CompositionLocalProvider(LocalViewModelStoreOwner provides activeOwner) {
            SignedInApp(container, active, openChatRequested, onOpenChatRequestConsumed)
        }
    }
}

@Composable
private fun SignedInApp(
    container: AppContainer,
    active: Session,
    openChatRequested: Boolean,
    onOpenChatRequestConsumed: () -> Unit,
) {
    val context = LocalContext.current
    // Android 13+ 请求通知权限（拒绝不影响 App 正常使用）
    val notificationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }
    LaunchedEffect(Unit) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    val chat: ChatViewModel = simpleViewModel(active.screenStateKey("chat")) {
        ChatViewModel(container.chat)
    }
    val search: ChatSearchViewModel = simpleViewModel(active.screenStateKey("chat-search")) {
        ChatSearchViewModel(container.chatSearch)
    }
    val settings: SettingsViewModel = simpleViewModel(active.screenStateKey("settings")) {
        SettingsViewModel(active.accountId, container.profiles)
    }
    val momentsRepository = remember(active.screenStateKey("moments-repository")) {
        container.moments(active)
    }
    val moments: MomentsViewModel = simpleViewModel(active.screenStateKey("moments")) {
        MomentsViewModel(momentsRepository, container.readStates)
    }
    val updates: UpdateViewModel = simpleViewModel(active.screenStateKey("updates")) {
        UpdateViewModel(container.updates)
    }
    val partnerId = if (active.accountId == "1001") "1002" else "1001"
    val remark: RemarkViewModel = simpleViewModel(active.screenStateKey("remark")) {
        RemarkViewModel(partnerId, container.remarks)
    }
    val chatState by chat.state.collectAsState()
    val searchState by search.state.collectAsState()
    val settingsState by settings.state.collectAsState()
    val momentsState by moments.state.collectAsState()
    val updateState by updates.state.collectAsState()
    val remarkState by remark.state.collectAsState()
    LaunchedEffect(active.screenStateKey("read-state")) {
        container.readStates.activateCurrentSession()
    }
    val profiles by container.profiles.profiles.collectAsState()
    val navController = rememberNavController()
    val scope = rememberCoroutineScope()

    ForegroundSync(chat) { container.profiles.refresh() }

    val own = profiles.find { it.accountId == active.accountId }
    val partner = profiles.find { it.accountId != active.accountId }
    if (own == null || partner == null) {
        BetweenEntryScreen(
            restoreFailed = true,
            onRetry = { scope.launch { runCatching { container.profiles.prepareForEntry(active) } } },
        )
        return
    }

    val resolvedPartnerName by remember(active.screenStateKey("resolved-partner"), partner.displayName) {
        container.remarks.displayName(partner.accountId, partner.displayName)
    }.collectAsState(partner.displayName)
    val displayedPartner = partner.copy(displayName = resolvedPartnerName)

    SignedInNavHost(
        navController = navController,
        active = active,
        ownProfile = own,
        partnerProfile = displayedPartner,
        chatState = chatState,
        searchState = searchState,
        settingsState = settingsState,
        momentsState = momentsState,
        updateState = updateState,
       remarkState = remarkState,
       updateInstaller = container.updatePlatform,
       onChatVisibilityChanged = { visible ->
           if (visible) container.appForeground.onChatForeground()
           else container.appForeground.onChatBackground()
       },
        openChatRequested = openChatRequested,
        onOpenChatRequestConsumed = onOpenChatRequestConsumed,
       actions = SignedInActions(
            onMessageVisible = chat::onMessageVisible,
            onChatReadVisibilityChanged = chat::onChatReadVisibilityChanged,
            onMarkMomentsSeen = moments::markSeen,
            onChatInputChanged = chat::setInput,
            onSend = chat::send,
            onRetryMessage = chat::retry,
            onClearError = chat::clearError,
            onImageSelected = { uri ->
                scope.launch {
                    try {
                        val image = container.imageProcessor.process(uri)
                        // 只进入待确认状态，用户在预览里点“发送”才真正上传。
                        chat.selectImage(image.bytes, image.mimeType, image.width, image.height)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Throwable) {
                        chat.showError(error.message?.takeIf(String::isNotBlank) ?: "无法处理图片")
                    }
                }
            },
            onConfirmPendingImage = chat::confirmPendingImage,
            onPendingImageCaptionChanged = chat::setPendingImageCaption,
            onCancelPendingImage = chat::cancelPendingImage,
            onSaveImage = { message ->
                scope.launch {
                    val fileId = message.imageFileId ?: return@launch
                    try {
                        val bytes = chat.resolveImageBytes(fileId)
                        if (bytes == null) {
                            chat.showError("图片下载失败，无法保存")
                        } else if (container.gallerySaver.save(bytes, "${message.id}.jpg", "image/jpeg")) {
                            chat.showError("已保存到相册")
                        } else {
                            chat.showError("保存失败")
                        }
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Throwable) {
                        chat.showError("保存失败")
                    }
                }
            },
            resolveImageUrl = chat::resolveImageUrl,
            onLoadOlder = chat::loadOlder,
            onQuoteMessage = chat::quote,
            onCancelQuote = chat::cancelQuote,
            onFocusMessage = chat::focusMessage,
            onFocusConsumed = chat::consumeFocus,
            onSearchQueryChanged = search::setQuery,
            onSearchDate = { date -> search.firstMessageOn(date)?.id },
            onRemarkChanged = remark::setValue,
            onSaveRemark = remark::save,
            onRemarkSavedConsumed = remark::consumeSaved,
            onRefreshMoments = moments::refresh,
            onMomentDraftChanged = moments::setDraft,
            onMomentVisibilityChanged = moments::setVisibility,
            onMomentImageSelected = { uri ->
                scope.launch {
                    try {
                        val image = container.imageProcessor.process(uri)
                        moments.setPendingImage(uri.toString(), image)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Throwable) {
                        moments.showError(error.message?.takeIf(String::isNotBlank) ?: "无法处理图片")
                    }
                }
            },
            onClearMomentImage = moments::clearPendingImage,
            onPublishMoment = moments::publish,
            onPublishCompletionConsumed = moments::consumePublishCompletion,
            onLikeMoment = moments::like,
            onUnlikeMoment = moments::unlike,
            onDeleteMoment = moments::delete,
            onCommentDraftChanged = moments::setCommentDraft,
            onComment = moments::comment,
            onDeleteComment = moments::deleteComment,
            onStartComment = moments::startComment,
            onCancelReply = moments::cancelReply,
            onToggleExpanded = moments::toggleExpandComments,
            onDisplayNameChanged = settings::setDisplayName,
            onSaveDisplayName = settings::saveDisplayName,
            onAvatarSelected = { uri ->
                scope.launch {
                    try {
                        val avatar = container.avatars.process(uri)
                        settings.uploadAvatar(avatar.mimeType, avatar.base64)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Throwable) {
                        settings.showAvatarError(
                            error.message?.takeIf(String::isNotBlank) ?: "无法处理头像",
                        )
                    }
                }
            },
            onCurrentPasswordChanged = settings::setCurrentPassword,
            onNewPasswordChanged = settings::setNewPassword,
            onChangePassword = settings::changePassword,
            onClearSettingsFeedback = settings::clearFeedback,
            onLogout = settings::logout,
            onCheckUpdate = updates::check,
            onStartUpdate = updates::startUpdate,
            onDismissUpdate = updates::dismissAvailable,
            onInstallRequestConsumed = updates::consumeInstallRequest,
        ),
    )
}

internal class SignedInActions(
    val onChatInputChanged: (String) -> Unit = {},
    val onSend: () -> Unit = {},
    val onRetryMessage: () -> Unit = {},
    val onClearError: () -> Unit = {},
    val onImageSelected: (Uri) -> Unit = {},
    val onConfirmPendingImage: () -> Unit = {},
    val onPendingImageCaptionChanged: (String) -> Unit = {},
    val onCancelPendingImage: () -> Unit = {},
    val onSaveImage: (com.privatechat.couplechat.core.model.ChatMessage) -> Unit = {},
    val resolveImageUrl: suspend (String) -> String? = { null },
    val onLoadOlder: () -> Unit = {},
    val onQuoteMessage: (com.privatechat.couplechat.core.model.ChatMessage) -> Unit = {},
    val onCancelQuote: () -> Unit = {},
    val onFocusMessage: (String) -> Unit = {},
    val onFocusConsumed: () -> Unit = {},
    val onSearchQueryChanged: (String) -> Unit = {},
    val onSearchDate: suspend (String) -> String? = { null },
    val onRemarkChanged: (String) -> Unit = {},
    val onSaveRemark: () -> Unit = {},
    val onRemarkSavedConsumed: () -> Unit = {},
    val onRefreshMoments: () -> Unit = {},
    val onMomentDraftChanged: (String) -> Unit = {},
    val onMomentVisibilityChanged: (MomentVisibility) -> Unit = {},
    val onMomentImageSelected: (Uri) -> Unit = {},
    val onClearMomentImage: () -> Unit = {},
    val onPublishMoment: () -> String? = { null },
    val onPublishCompletionConsumed: (String) -> Unit = {},
    val onLikeMoment: (String) -> Unit = {},
    val onUnlikeMoment: (String) -> Unit = {},
    val onDeleteMoment: (String) -> Unit = {},
    val onCommentDraftChanged: (String, String) -> Unit = { _, _ -> },
    val onComment: (String) -> Unit = {},
    val onDeleteComment: (String) -> Unit = {},
    val onStartComment: (String, String?) -> Unit = { _, _ -> },
    val onCancelReply: (String) -> Unit = {},
    val onToggleExpanded: (String) -> Unit = {},
    val onMarkChatRead: () -> Unit = {},
    val onMessageVisible: (com.privatechat.couplechat.core.model.MessageCursor) -> Unit = {},
    val onChatReadVisibilityChanged: (Boolean) -> Unit = {},
    val onMarkMomentsSeen: () -> Unit = {},
    val onDisplayNameChanged: (String) -> Unit = {},
    val onSaveDisplayName: () -> Unit = {},
    val onAvatarSelected: (Uri) -> Unit = {},
    val onCurrentPasswordChanged: (String) -> Unit = {},
    val onNewPasswordChanged: (String) -> Unit = {},
    val onChangePassword: () -> Unit = {},
    val onClearSettingsFeedback: () -> Unit = {},
    val onLogout: () -> Unit = {},
    val onCheckUpdate: () -> Unit = {},
    val onStartUpdate: () -> Unit = {},
    val onDismissUpdate: () -> Unit = {},
    val onInstallRequestConsumed: () -> Unit = {},
)

@Composable
internal fun SignedInNavHost(
    navController: NavHostController,
    active: Session,
    ownProfile: Profile,
    partnerProfile: Profile,
    chatState: ChatState,
    searchState: ChatSearchState = ChatSearchState(),
    settingsState: SettingsState,
    momentsState: MomentsState,
    updateState: UpdateState = UpdateState(),
    remarkState: RemarkState = RemarkState(),
    updateInstaller: com.privatechat.couplechat.core.update.UpdateInstallBridge? = null,
    onChatVisibilityChanged: (Boolean) -> Unit = {},
    openChatRequested: Boolean = false,
    onOpenChatRequestConsumed: () -> Unit = {},
    actions: SignedInActions,
) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(openChatRequested) {
        if (!openChatRequested) return@LaunchedEffect
        navController.navigate(Routes.CHAT) { launchSingleTop = true }
        onOpenChatRequestConsumed()
    }
    NavHost(
        navController = navController,
        startDestination = SIGNED_IN_START_DESTINATION,
        enterTransition = { EnterTransition.None },
        exitTransition = { ExitTransition.None },
        popEnterTransition = { EnterTransition.None },
        popExitTransition = { ExitTransition.None },
    ) {
        composable(Routes.HOME) {
            HomeScreen(
                ownProfile = ownProfile,
                partnerProfile = partnerProfile,
                messages = chatState.messages,
                unreadCount = chatState.unreadCount,
                hasUnseenMoments = momentsState.hasUnseen,
                onOpenChat = { navController.open(Routes.CHAT) },
                onOpenMoments = { navController.open(Routes.MOMENTS) },
                onOpenProfile = { navController.open(Routes.PROFILE) },
                onOpenSettings = { navController.open(Routes.SETTINGS) },
            )
       }
        composable(Routes.CHAT) {
            ChatNotificationVisibility { visible ->
                onChatVisibilityChanged(visible)
                actions.onChatReadVisibilityChanged(visible)
            }
            ChatScreen(
                state = chatState,
                ownProfile = ownProfile,
                partner = partnerProfile,
                onInputChanged = actions.onChatInputChanged,
                onSend = actions.onSend,
                onRetry = actions.onRetryMessage,
                onClearError = actions.onClearError,
                onLoadOlder = actions.onLoadOlder,
                onQuote = actions.onQuoteMessage,
                onCancelQuote = actions.onCancelQuote,
                onFocusConsumed = actions.onFocusConsumed,
                onBack = navController::navigateUp,
                onOpenInfo = { navController.open(Routes.CHAT_INFO) },
                onOpenProfile = { navController.open(Routes.PARTNER_PROFILE) },
                onOpenOwnProfile = { navController.open(Routes.PROFILE) },
                onImageSelected = actions.onImageSelected,
                onConfirmPendingImage = actions.onConfirmPendingImage,
                onPendingImageCaptionChanged = actions.onPendingImageCaptionChanged,
                onCancelPendingImage = actions.onCancelPendingImage,
                onSaveImage = actions.onSaveImage,
                resolveImageUrl = actions.resolveImageUrl,
                onMessageVisible = actions.onMessageVisible,
            )
        }
        composable(Routes.CHAT_INFO) {
            ChatInfoScreen(
                partner = partnerProfile,
                onBack = navController::navigateUp,
                onOpenRemark = { navController.open(Routes.REMARK) },
                onOpenSearch = { navController.open(Routes.CHAT_SEARCH) },
            )
        }
        composable(Routes.PARTNER_PROFILE) {
            LaunchedEffect(Unit) { actions.onRefreshMoments() }
            val partnerMomentFileIds = remember(partnerProfile.accountId, momentsState.items) {
                momentsState.items
                    .filter { it.authorId == partnerProfile.accountId && it.imageFileId != null }
                    .mapNotNull { it.imageFileId }
                    // momentsState.items 后端已按最新在前返回；取最新 4 张并保持“最新在左”。
                    .take(4)
            }
            var previewImageUrls by remember { mutableStateOf<List<String>>(emptyList()) }
            LaunchedEffect(partnerMomentFileIds) {
                previewImageUrls = partnerMomentFileIds.mapNotNull { actions.resolveImageUrl(it) }
            }
            ContactDetailScreen(
                partner = partnerProfile,
                onBack = navController::navigateUp,
                onOpenChat = {
                    if (!navController.popBackStack(Routes.CHAT, inclusive = false)) {
                        navController.open(Routes.CHAT)
                    }
                },
                onOpenMoments = { navController.open(Routes.MOMENTS_OF) },
                previewImageUrls = previewImageUrls,
            )
        }
        composable(Routes.CHAT_SEARCH) {
            ChatSearchScreen(
                state = searchState,
                onQueryChanged = actions.onSearchQueryChanged,
                onOpenDate = { navController.open(Routes.CHAT_DATE) },
                onOpenMessage = { messageId ->
                    actions.onFocusMessage(messageId)
                    navController.popBackStack(Routes.CHAT, inclusive = false)
                },
                onBack = navController::navigateUp,
            )
        }
        composable(Routes.CHAT_DATE) {
            ChatDateScreen(
                dates = searchState.dates,
                onDateSelected = { date ->
                    scope.launch {
                        actions.onSearchDate(date)?.let { messageId ->
                            actions.onFocusMessage(messageId)
                            navController.popBackStack(Routes.CHAT, inclusive = false)
                        }
                    }
                },
                onBack = navController::navigateUp,
            )
        }
        composable(Routes.REMARK) {
            LaunchedEffect(remarkState.saved) {
                if (remarkState.saved) {
                    actions.onRemarkSavedConsumed()
                    navController.navigateUp()
                }
            }
            RemarkEditScreen(
                value = remarkState.value,
                saving = remarkState.saving,
                error = remarkState.error,
                onValueChanged = actions.onRemarkChanged,
                onSave = actions.onSaveRemark,
                onBack = navController::navigateUp,
            )
        }
        composable(Routes.MOMENTS) {
            LaunchedEffect(Unit) {
                actions.onRefreshMoments()
                actions.onMarkMomentsSeen()
            }
            MomentsScreen(
                state = momentsState,
                ownProfile = ownProfile,
                partnerProfile = partnerProfile,
                onBack = navController::navigateUp,
                onOpenComposer = { navController.open(Routes.MOMENT_COMPOSE) },
                onRefresh = actions.onRefreshMoments,
                resolveImageUrl = actions.resolveImageUrl,
                onLike = actions.onLikeMoment,
                onUnlike = actions.onUnlikeMoment,
                onDeleteMoment = actions.onDeleteMoment,
                onCommentDraftChanged = actions.onCommentDraftChanged,
                onComment = actions.onComment,
                onDeleteComment = actions.onDeleteComment,
                onStartComment = actions.onStartComment,
                onCancelReply = actions.onCancelReply,
                onToggleExpanded = actions.onToggleExpanded,
                onOpenAuthorProfile = { profile ->
                    if (profile.accountId == ownProfile.accountId) {
                        navController.open(Routes.PROFILE)
                    } else {
                        navController.open(Routes.PARTNER_PROFILE)
                    }
                },
            )
        }
        composable(Routes.MOMENTS_OF) {
            MomentsScreen(
                state = momentsState,
                ownProfile = ownProfile,
                partnerProfile = partnerProfile,
                onBack = navController::navigateUp,
                onOpenComposer = {},
                onRefresh = actions.onRefreshMoments,
                filterAccountId = partnerProfile.accountId,
                title = "TA的朋友圈",
                showComposer = false,
                resolveImageUrl = actions.resolveImageUrl,
                onLike = actions.onLikeMoment,
                onUnlike = actions.onUnlikeMoment,
                onDeleteMoment = actions.onDeleteMoment,
                onCommentDraftChanged = actions.onCommentDraftChanged,
                onComment = actions.onComment,
                onDeleteComment = actions.onDeleteComment,
                onStartComment = actions.onStartComment,
                onCancelReply = actions.onCancelReply,
                onToggleExpanded = actions.onToggleExpanded,
                onOpenAuthorProfile = {
                    // 破循环：对方朋友圈里点头像返回资料页，不再新压一页
                    if (!navController.popBackStack()) navController.navigateUp()
                },
            )
        }
        composable(Routes.MOMENT_COMPOSE) {
            MomentComposerScreen(
                state = momentsState,
                onCancel = navController::navigateUp,
                onDraftChanged = actions.onMomentDraftChanged,
                onVisibilityChanged = actions.onMomentVisibilityChanged,
                onImageSelected = actions.onMomentImageSelected,
                onClearImage = actions.onClearMomentImage,
                onPublish = actions.onPublishMoment,
                onPublishCompletionConsumed = actions.onPublishCompletionConsumed,
                onPublished = {
                    if (navController.currentDestination?.route == Routes.MOMENT_COMPOSE) {
                        navController.popBackStack()
                    }
                },
            )
        }
        composable(Routes.PROFILE) {
            LaunchedEffect(Unit) { actions.onClearSettingsFeedback() }
            ProfileEditScreen(
                state = settingsState,
                onBack = navController::navigateUp,
                onOpenDisplayName = { navController.open(Routes.PROFILE_NAME) },
                onAvatarSelected = actions.onAvatarSelected,
            )
        }
        composable(Routes.PROFILE_NAME) {
            LaunchedEffect(Unit) { actions.onClearSettingsFeedback() }
            DisplayNameEditScreen(
                state = settingsState,
                onBack = navController::navigateUp,
                onDisplayNameChanged = actions.onDisplayNameChanged,
                onSaveDisplayName = actions.onSaveDisplayName,
            )
        }
        composable(Routes.SETTINGS) {
            LaunchedEffect(Unit) { actions.onClearSettingsFeedback() }
            SettingsScreen(
                state = settingsState,
                onBack = navController::navigateUp,
                onOpenPassword = { navController.open(Routes.PASSWORD) },
                onOpenAbout = { navController.open(Routes.ABOUT) },
                onLogout = actions.onLogout,
                updateState = updateState,
                updateInstaller = updateInstaller,
                onCheckUpdate = actions.onCheckUpdate,
                onStartUpdate = actions.onStartUpdate,
                onDismissUpdate = actions.onDismissUpdate,
                onInstallRequestConsumed = actions.onInstallRequestConsumed,
            )
        }
        composable(Routes.ABOUT) {
            AboutScreen(onBack = navController::navigateUp)
        }
        composable(Routes.PASSWORD) {
            LaunchedEffect(Unit) { actions.onClearSettingsFeedback() }
            PasswordEditScreen(
                state = settingsState,
                onBack = navController::navigateUp,
                onCurrentPasswordChanged = actions.onCurrentPasswordChanged,
                onNewPasswordChanged = actions.onNewPasswordChanged,
                onChangePassword = actions.onChangePassword,
            )
        }
    }
}

private fun NavHostController.open(route: String) {
    navigate(route) { launchSingleTop = true }
}

@Composable
internal fun ProfileLoadFailure(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("资料加载失败", color = MaterialTheme.colorScheme.error)
        TextButton(onClick = onRetry, colors = betweenTextButtonColors()) { Text("重试") }
    }
}

@Composable
private fun ChatNotificationVisibility(onVisibilityChanged: (Boolean) -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnVisibilityChanged = rememberUpdatedState(onVisibilityChanged)
    DisposableEffect(lifecycleOwner) {
        var visible = false
        fun setVisible(next: Boolean) {
            if (visible == next) return
            visible = next
            currentOnVisibilityChanged.value(next)
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> setVisible(true)
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> setVisible(false)
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        setVisible(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        onDispose {
            setVisible(false)
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }
}

@Composable
private fun ForegroundSync(chat: ChatViewModel, refreshProfiles: suspend () -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val currentRefreshProfiles by rememberUpdatedState(refreshProfiles)
    DisposableEffect(lifecycleOwner, chat) {
        var profileJob: Job? = null
        fun start() {
            chat.onForeground()
            profileJob?.cancel()
            profileJob = scope.launch {
                while (isActive) {
                    try {
                        currentRefreshProfiles()
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Throwable) {
                        // The next lifecycle/profile polling interval retries necessary profile data.
                    }
                    delay(PROFILE_REFRESH_INTERVAL)
                }
            }
        }
        fun stop() {
            profileJob?.cancel()
            profileJob = null
            chat.onBackground()
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> start()
                Lifecycle.Event.ON_STOP -> stop()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) start()
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            stop()
        }
    }
}

@Composable
private inline fun <reified T : ViewModel> simpleViewModel(
    key: String,
    crossinline create: () -> T,
): T = viewModel(
    key = key,
    factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <VM : ViewModel> create(modelClass: Class<VM>): VM = create() as VM
    },
)
